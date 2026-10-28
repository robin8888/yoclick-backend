import { Injectable } from '@nestjs/common';
import { v7 as generateUuidV7 } from 'uuid';
import {
  type TenantTransactionClient,
  TenantPrismaService,
} from '../../../shared/database/tenant-prisma.service';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import {
  type BlockedPersonView,
  type BlockTarget,
  type ChatModerationRepository,
  type CreatedMessageReport,
  type MessageReportView,
  type NewMessageReport,
  type ReportableMessage,
} from '../application/ports/chat-moderation.repository';
import { markMessageNoticesRead } from './chat-notices';
import { PERSON_SELECT, type StoredPerson } from './chat-views';

const REPORT_INCLUDE = {
  reporter: { select: { user: { select: { fullName: true } } } },
  reportedSender: { select: { user: { select: { fullName: true } } } },
} as const;

interface StoredReport {
  readonly id: string;
  readonly reason: MessageReportView['reason'];
  readonly details: string | null;
  readonly status: MessageReportView['status'];
  readonly reportedBody: string | null;
  readonly reportedAttachmentName: string | null;
  readonly createdAt: Date;
  readonly reviewedAt: Date | null;
  readonly reporter: { readonly user: { readonly fullName: string } };
  readonly reportedSender: { readonly user: { readonly fullName: string } };
}

function toReportView(report: StoredReport): MessageReportView {
  return {
    id: report.id,
    reason: report.reason,
    details: report.details,
    status: report.status,
    reporterName: report.reporter.user.fullName,
    reportedSenderName: report.reportedSender.user.fullName,
    reportedBody: report.reportedBody,
    reportedAttachmentName: report.reportedAttachmentName,
    createdAt: report.createdAt,
    reviewedAt: report.reviewedAt,
  };
}

function toBlockedPerson(input: { person: StoredPerson; blockedAt: Date }): BlockedPersonView {
  return {
    membershipId: input.person.id,
    fullName: input.person.user.fullName,
    role: input.person.role,
    photoKey: input.person.user.photoKey,
    blockedAt: input.blockedAt,
  };
}

/**
 * Al bloquear a alguien se dan por leídos los avisos de sus mensajes: quien bloquea no quiere seguir viendo
 * «tienes un mensaje nuevo» de esa persona.
 */
async function markBlockedNoticesRead(
  client: TenantTransactionClient,
  input: { actor: ActorContext; blockedMembershipId: string },
): Promise<void> {
  const { actor, blockedMembershipId } = input;
  const conversations = await client.conversation.findMany({
    where: {
      OR: [
        { memberMembershipId: actor.membershipId, counterpartMembershipId: blockedMembershipId },
        { memberMembershipId: blockedMembershipId, counterpartMembershipId: actor.membershipId },
      ],
    },
    select: { id: true },
  });
  const readAt = new Date();
  for (const { id } of conversations) {
    await markMessageNoticesRead(client, {
      conversationId: id,
      membershipId: actor.membershipId,
      readAt,
    });
  }
}

/**
 * Avisa a quienes administran el centro de que hay una denuncia por revisar, menos a quien la hizo. El aviso
 * lleva solo el motivo: el texto denunciado nunca viaja en un aviso, solo se lee en la lista de denuncias.
 */
async function notifyAdministrators(
  client: TenantTransactionClient,
  input: { actor: ActorContext; reason: string },
): Promise<void> {
  const administrators = await client.membership.findMany({
    where: {
      role: { in: ['owner', 'admin'] },
      status: 'active',
      id: { not: input.actor.membershipId },
    },
    select: { id: true },
  });
  await client.notification.createMany({
    data: administrators.map(({ id }) => ({
      id: generateUuidV7(),
      centerId: input.actor.centerId,
      recipientMembershipId: id,
      kind: 'message_reported' as const,
      data: { reason: input.reason },
    })),
  });
}

@Injectable()
export class PrismaChatModerationRepository implements ChatModerationRepository {
  constructor(private readonly tenantPrismaService: TenantPrismaService) {}

  async findBlockTarget(actor: ActorContext, membershipId: string): Promise<BlockTarget | null> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const target = await client.membership.findFirst({
        where: { id: membershipId, status: 'active' },
        select: { id: true, role: true },
      });
      return target ?? null;
    });
  }

  async listBlocks(actor: ActorContext): Promise<BlockedPersonView[]> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const blocks = await client.chatBlock.findMany({
        where: { blockerMembershipId: actor.membershipId },
        include: { blocked: { select: PERSON_SELECT } },
        orderBy: { createdAt: 'desc' },
      });
      return blocks.map((block) =>
        toBlockedPerson({ person: block.blocked, blockedAt: block.createdAt }),
      );
    });
  }

  async addBlock(actor: ActorContext, blockedMembershipId: string): Promise<BlockedPersonView> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const block = await client.chatBlock.upsert({
        where: {
          blockerMembershipId_blockedMembershipId: {
            blockerMembershipId: actor.membershipId,
            blockedMembershipId,
          },
        },
        create: {
          centerId: actor.centerId,
          blockerMembershipId: actor.membershipId,
          blockedMembershipId,
        },
        update: {},
        include: { blocked: { select: PERSON_SELECT } },
      });
      await markBlockedNoticesRead(client, { actor, blockedMembershipId });
      return toBlockedPerson({ person: block.blocked, blockedAt: block.createdAt });
    });
  }

  async removeBlock(actor: ActorContext, blockedMembershipId: string): Promise<void> {
    await this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      await client.chatBlock.deleteMany({
        where: { blockerMembershipId: actor.membershipId, blockedMembershipId },
      });
    });
  }

  async findReportableMessage(
    actor: ActorContext,
    request: { conversationId: string; messageId: string },
  ): Promise<ReportableMessage | null> {
    // La seguridad por filas de `messages` solo deja ver los de conversaciones donde se participa.
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const message = await client.message.findFirst({
        where: { id: request.messageId, conversationId: request.conversationId },
        select: { id: true, senderMembershipId: true, body: true, attachmentName: true },
      });
      return message ?? null;
    });
  }

  async createReport(actor: ActorContext, report: NewMessageReport): Promise<CreatedMessageReport> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      // `skipDuplicates` (ON CONFLICT DO NOTHING) deja válida la transacción si dos peticiones llegan a la vez.
      const created = await client.messageReport.createMany({
        data: {
          id: report.id,
          centerId: actor.centerId,
          messageId: report.message.id,
          reporterMembershipId: actor.membershipId,
          reportedSenderMembershipId: report.message.senderMembershipId,
          reason: report.reason,
          details: report.details,
          reportedBody: report.message.body,
          reportedAttachmentName: report.message.attachmentName,
        },
        skipDuplicates: true,
      });
      if (created.count === 0) {
        const existing = await client.messageReport.findUniqueOrThrow({
          where: {
            messageId_reporterMembershipId: {
              messageId: report.message.id,
              reporterMembershipId: actor.membershipId,
            },
          },
          select: { id: true, status: true },
        });
        return { reportId: existing.id, status: existing.status, isNew: false };
      }
      await notifyAdministrators(client, { actor, reason: report.reason });
      return { reportId: report.id, status: 'open' as const, isNew: true };
    });
  }

  async listReports(
    actor: ActorContext,
    query: { status: 'open' | 'reviewed' | null; limit: number },
  ): Promise<MessageReportView[]> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const reports = await client.messageReport.findMany({
        where: query.status === null ? {} : { status: query.status },
        include: REPORT_INCLUDE,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit,
      });
      return reports.map(toReportView);
    });
  }

  async reviewReport(
    actor: ActorContext,
    request: { reportId: string; reviewedAt: Date },
  ): Promise<MessageReportView | null> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      await client.messageReport.updateMany({
        where: { id: request.reportId, status: 'open' },
        data: {
          status: 'reviewed',
          reviewedByMembershipId: actor.membershipId,
          reviewedAt: request.reviewedAt,
        },
      });
      const report = await client.messageReport.findUnique({
        where: { id: request.reportId },
        include: REPORT_INCLUDE,
      });
      return report === null ? null : toReportView(report);
    });
  }
}
