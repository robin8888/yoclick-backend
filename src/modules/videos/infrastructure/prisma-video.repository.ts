import { Injectable } from '@nestjs/common';
import {
  TenantPrismaService,
  type TenantTransactionClient,
} from '../../../shared/database/tenant-prisma.service';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import {
  type NewVideo,
  type ProcessingUpdate,
  type StoredVideo,
  type VideoRepository,
  type VideoStorageFacts,
} from '../application/ports/video.repository';
import { VIDEO_SELECT } from './video-select';

const NO_BYTES = BigInt(0);

/** Pone el vídeo como el de presentación de la persona y borra el anterior; devuelve el que sobraba. */
async function replaceProfileVideo(
  client: TenantTransactionClient,
  request: { membershipId: string; videoId: string },
): Promise<string | null> {
  const previous = await client.membership.findUnique({
    where: { id: request.membershipId },
    select: { profileVideo: { select: { id: true, providerVideoId: true } } },
  });
  await client.membership.update({
    where: { id: request.membershipId },
    data: { profileVideoId: request.videoId },
  });
  if (!previous?.profileVideo) return null;
  await client.video.delete({ where: { id: previous.profileVideo.id } });
  return previous.profileVideo.providerVideoId;
}

/** Añadir un vídeo al perfil lo cambia: vuelve a borrador hasta que se envíe de nuevo a revisión. */
async function markProfileAsDraft(
  client: TenantTransactionClient,
  actor: ActorContext,
  membershipId: string,
): Promise<void> {
  await client.staffProfile.upsert({
    where: { membershipId },
    create: { membershipId, centerId: actor.centerId, status: 'draft' },
    update: { status: 'draft' },
  });
}

@Injectable()
export class PrismaVideoRepository implements VideoRepository {
  constructor(private readonly tenantPrismaService: TenantPrismaService) {}

  async readStorageFacts(actor: ActorContext): Promise<VideoStorageFacts> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const center = await client.center.findUniqueOrThrow({
        where: { id: actor.centerId },
        select: { videoStorageLimitBytes: true },
      });
      const used = await client.video.aggregate({
        _sum: { sizeBytes: true },
        where: { status: { not: 'failed' } },
      });
      return {
        storageLimitBytes: center.videoStorageLimitBytes,
        usedBytes: used._sum.sizeBytes ?? NO_BYTES,
      };
    });
  }

  async countTechniqueVideos(actor: ActorContext, membershipId: string): Promise<number> {
    return this.tenantPrismaService.runInTenantContext(actor, (client) =>
      client.video.count({ where: { techniqueOfMembershipId: membershipId } }),
    );
  }

  async create(
    actor: ActorContext,
    video: NewVideo,
  ): Promise<{ replacedProviderVideoId: string | null }> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      await client.video.create({
        data: {
          id: video.id,
          centerId: actor.centerId,
          providerVideoId: video.providerVideoId,
          title: video.title,
          sizeBytes: video.requestedBytes,
          uploadedByMembershipId: actor.membershipId,
          ...(video.attachment?.kind === 'technique' && {
            techniqueOfMembershipId: video.attachment.membershipId,
          }),
        },
      });
      if (video.attachment === null) return { replacedProviderVideoId: null };
      await markProfileAsDraft(client, actor, video.attachment.membershipId);
      if (video.attachment.kind === 'technique') return { replacedProviderVideoId: null };
      const replacedProviderVideoId = await replaceProfileVideo(client, {
        membershipId: video.attachment.membershipId,
        videoId: video.id,
      });
      return { replacedProviderVideoId };
    });
  }

  async find(actor: ActorContext, videoId: string): Promise<StoredVideo | null> {
    return this.tenantPrismaService.runInTenantContext(actor, (client) =>
      client.video.findUnique({ where: { id: videoId }, select: VIDEO_SELECT }),
    );
  }

  async applyProcessingUpdate(
    actor: ActorContext,
    videoId: string,
    update: ProcessingUpdate,
  ): Promise<StoredVideo | null> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const existing = await client.video.count({ where: { id: videoId } });
      if (existing === 0) return null;
      return client.video.update({ where: { id: videoId }, data: update, select: VIDEO_SELECT });
    });
  }

  async delete(actor: ActorContext, videoId: string): Promise<void> {
    await this.tenantPrismaService.runInTenantContext(actor, (client) =>
      client.video.deleteMany({ where: { id: videoId } }),
    );
  }
}
