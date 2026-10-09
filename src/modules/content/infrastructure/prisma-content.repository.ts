import { Injectable } from '@nestjs/common';
import { TenantPrismaService } from '../../../shared/database/tenant-prisma.service';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import {
  type AddVideoOutcome,
  type ContentChanges,
  type ContentRepository,
  type DocumentStorageFacts,
  type NewDocument,
  type NewVideoContent,
  type RemovedContent,
  type ReplaceAssignmentsOutcome,
  type StoredContent,
} from '../application/ports/content.repository';
import { selectAddedTargets, type ContentTarget } from '../domain/content-rules';
import {
  areAllTargetsValid,
  readCurrentTargets,
  replaceAssignmentRows,
} from './content-assignments';
import { recordContentNotices } from './content-notices';
import { CONTENT_SELECT, buildVisibleToClientFilter, toStoredContent } from './content-select';

const NO_BYTES = BigInt(0);

@Injectable()
export class PrismaContentRepository implements ContentRepository {
  constructor(private readonly tenantPrismaService: TenantPrismaService) {}

  async readDocumentStorageFacts(actor: ActorContext): Promise<DocumentStorageFacts> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const center = await client.center.findUniqueOrThrow({
        where: { id: actor.centerId },
        select: { documentStorageLimitBytes: true },
      });
      const used = await client.contentItem.aggregate({
        _sum: { sizeBytes: true },
        where: { kind: 'pdf' },
      });
      return {
        storageLimitBytes: center.documentStorageLimitBytes,
        usedBytes: used._sum.sizeBytes ?? NO_BYTES,
      };
    });
  }

  async list(actor: ActorContext): Promise<StoredContent[]> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const rows = await client.contentItem.findMany({
        orderBy: { createdAt: 'desc' },
        select: CONTENT_SELECT,
      });
      return rows.map(toStoredContent);
    });
  }

  async find(actor: ActorContext, contentId: string): Promise<StoredContent | null> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const row = await client.contentItem.findUnique({
        where: { id: contentId },
        select: CONTENT_SELECT,
      });
      return row && toStoredContent(row);
    });
  }

  async addDocument(actor: ActorContext, document: NewDocument): Promise<void> {
    await this.tenantPrismaService.runInTenantContext(actor, (client) =>
      client.contentItem.create({
        data: {
          id: document.id,
          centerId: actor.centerId,
          kind: 'pdf',
          title: document.title,
          need: document.need,
          level: document.level,
          documentKey: document.documentKey,
          sizeBytes: document.sizeBytes,
          pageCount: document.pageCount,
          createdByMembershipId: actor.membershipId,
        },
      }),
    );
  }

  async addVideo(actor: ActorContext, video: NewVideoContent): Promise<AddVideoOutcome> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const existing = await client.video.findUnique({
        where: { id: video.videoId },
        select: { contentItem: { select: { id: true } } },
      });
      if (!existing) return 'video_not_found';
      if (existing.contentItem) return 'video_already_in_library';
      await client.contentItem.create({
        data: {
          id: video.id,
          centerId: actor.centerId,
          kind: 'video',
          title: video.title,
          need: video.need,
          level: video.level,
          videoId: video.videoId,
          createdByMembershipId: actor.membershipId,
        },
      });
      return 'added';
    });
  }

  async update(
    actor: ActorContext,
    contentId: string,
    changes: ContentChanges,
  ): Promise<StoredContent | null> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      if ((await client.contentItem.count({ where: { id: contentId } })) === 0) return null;
      await client.contentItem.update({
        where: { id: contentId },
        data: {
          ...(changes.title !== undefined && { title: changes.title }),
          ...(changes.need !== undefined && { need: changes.need }),
          ...(changes.level !== undefined && { level: changes.level }),
        },
      });
      const row = await client.contentItem.findUniqueOrThrow({
        where: { id: contentId },
        select: CONTENT_SELECT,
      });
      return toStoredContent(row);
    });
  }

  async replaceAssignments(
    actor: ActorContext,
    request: { contentId: string; targets: readonly ContentTarget[] },
  ): Promise<ReplaceAssignmentsOutcome> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const content = await client.contentItem.findUnique({
        where: { id: request.contentId },
        select: { title: true, video: { select: { status: true } } },
      });
      if (!content) return 'not_found';
      if (!(await areAllTargetsValid(client, request.targets))) return 'invalid_target';
      const previousTargets = await readCurrentTargets(client, request.contentId);
      await replaceAssignmentRows(client, actor, request);
      // Un vídeo que aún se procesa no se ve: avisar ahora sería avisar de algo que no se puede abrir.
      if (content.video === null || content.video.status === 'ready') {
        await recordContentNotices(client, actor, {
          contentTitle: content.title,
          targets: selectAddedTargets(previousTargets, request.targets),
        });
      }
      return 'replaced';
    });
  }

  async remove(actor: ActorContext, contentId: string): Promise<RemovedContent | null> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const content = await client.contentItem.findUnique({
        where: { id: contentId },
        select: {
          documentKey: true,
          video: {
            select: { id: true, providerVideoId: true, _count: { select: { routineItems: true } } },
          },
        },
      });
      if (!content) return null;
      await client.contentItem.delete({ where: { id: contentId } });
      const freedVideo = content.video?._count.routineItems === 0 ? content.video : null;
      if (freedVideo) await client.video.delete({ where: { id: freedVideo.id } });
      return {
        documentKey: content.documentKey,
        orphanedProviderVideoId: freedVideo?.providerVideoId ?? null,
      };
    });
  }

  async listForClient(actor: ActorContext): Promise<StoredContent[]> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const rows = await client.contentItem.findMany({
        where: await buildVisibleToClientFilter(client, actor),
        orderBy: { createdAt: 'desc' },
        select: CONTENT_SELECT,
      });
      return rows.map(toStoredContent);
    });
  }

  async findForClient(actor: ActorContext, contentId: string): Promise<StoredContent | null> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const row = await client.contentItem.findFirst({
        where: { id: contentId, ...(await buildVisibleToClientFilter(client, actor)) },
        select: CONTENT_SELECT,
      });
      return row && toStoredContent(row);
    });
  }
}
