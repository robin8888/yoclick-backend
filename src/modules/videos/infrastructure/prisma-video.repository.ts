import { Injectable } from '@nestjs/common';
import { v7 as generateUuidV7 } from 'uuid';
import {
  TenantPrismaService,
  type TenantTransactionClient,
} from '../../../shared/database/tenant-prisma.service';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { VIDEO_SELECT } from './video-select';
import { type VideoNotificationData } from '../../notifications/domain/notification-rules';
import {
  type NewVideo,
  type ProcessingUpdate,
  type ReviewOutcome,
  type StoredVideo,
  type TeamProfileView,
  type VideoRepository,
  type VideoStorageFacts,
} from '../application/ports/video.repository';

const NO_BYTES = BigInt(0);

async function readMemberName(
  client: TenantTransactionClient,
  membershipId: string,
): Promise<string> {
  const member = await client.membership.findUnique({
    where: { id: membershipId },
    select: { user: { select: { fullName: true } } },
  });
  return member?.user.fullName ?? '';
}

/** Deja el aviso; el envío al móvil ocurre después, cuando la acción ya está guardada. */
async function recordVideoNotices(
  client: TenantTransactionClient,
  request: {
    actor: ActorContext;
    kind: 'staff_video_submitted' | 'staff_video_reviewed';
    recipientMembershipIds: readonly string[];
    uploaderMembershipId: string;
  },
): Promise<void> {
  const recipients = request.recipientMembershipIds.filter(
    (membershipId) => membershipId !== request.actor.membershipId,
  );
  if (recipients.length === 0) return;
  const noticeData: VideoNotificationData = {
    uploaderName: await readMemberName(client, request.uploaderMembershipId),
    actorName: await readMemberName(client, request.actor.membershipId),
  };
  await client.notification.createMany({
    data: recipients.map((recipientMembershipId) => ({
      id: generateUuidV7(),
      centerId: request.actor.centerId,
      recipientMembershipId,
      kind: request.kind,
      data: noticeData,
    })),
  });
}

async function findAdministratorIds(client: TenantTransactionClient): Promise<string[]> {
  const administrators = await client.membership.findMany({
    where: { role: { in: ['owner', 'admin'] }, status: 'active' },
    select: { id: true },
  });
  return administrators.map(({ id }) => id);
}

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
          reviewStatus: video.reviewStatus,
          uploadedByMembershipId: actor.membershipId,
        },
      });
      if (video.profileOfMembershipId === null) return { replacedProviderVideoId: null };
      const replacedProviderVideoId = await replaceProfileVideo(client, {
        membershipId: video.profileOfMembershipId,
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
      const before = await client.video.findUnique({
        where: { id: videoId },
        select: VIDEO_SELECT,
      });
      if (!before) return null;
      const saved = await client.video.update({
        where: { id: videoId },
        data: update,
        select: VIDEO_SELECT,
      });
      const hasJustBecomeReady = before.status !== 'ready' && saved.status === 'ready';
      if (hasJustBecomeReady && saved.reviewStatus === 'pending') {
        await recordVideoNotices(client, {
          actor,
          kind: 'staff_video_submitted',
          recipientMembershipIds: await findAdministratorIds(client),
          uploaderMembershipId: saved.uploadedByMembershipId,
        });
      }
      return saved;
    });
  }

  async delete(actor: ActorContext, videoId: string): Promise<void> {
    await this.tenantPrismaService.runInTenantContext(actor, (client) =>
      client.video.deleteMany({ where: { id: videoId } }),
    );
  }

  async review(
    actor: ActorContext,
    request: { videoId: string; isApproved: boolean; note: string | null },
  ): Promise<ReviewOutcome> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const video = await client.video.findUnique({
        where: { id: request.videoId },
        select: { ...VIDEO_SELECT, profileOf: { select: { id: true } } },
      });
      if (!video) return { kind: 'not_found' } as const;
      if (video.reviewStatus !== 'pending' || video.profileOf === null) {
        return { kind: 'not_reviewable' } as const;
      }
      const saved = await client.video.update({
        where: { id: request.videoId },
        data: {
          reviewStatus: request.isApproved ? 'approved' : 'changes_requested',
          reviewNote: request.isApproved ? null : request.note,
        },
        select: VIDEO_SELECT,
      });
      await recordVideoNotices(client, {
        actor,
        kind: 'staff_video_reviewed',
        recipientMembershipIds: [video.uploadedByMembershipId],
        uploaderMembershipId: video.uploadedByMembershipId,
      });
      return { kind: 'reviewed', video: saved } as const;
    });
  }

  async listTeamProfiles(actor: ActorContext): Promise<TeamProfileView[]> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const members = await client.membership.findMany({
        where: { role: { in: ['owner', 'admin', 'staff'] }, status: 'active' },
        orderBy: { joinedAt: 'asc' },
        select: {
          id: true,
          staffTitle: true,
          user: { select: { fullName: true } },
          profileVideo: { select: VIDEO_SELECT },
        },
      });
      return members.map((member) => ({
        membershipId: member.id,
        fullName: member.user.fullName,
        staffTitle: member.staffTitle,
        video: member.profileVideo,
      }));
    });
  }
}
