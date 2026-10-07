import { Injectable } from '@nestjs/common';
import { v7 as generateUuidV7 } from 'uuid';
import { Prisma } from '../../../generated/prisma/client';
import {
  TenantPrismaService,
  type TenantTransactionClient,
} from '../../../shared/database/tenant-prisma.service';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { type PrivacyNotificationData } from '../../notifications/domain/notification-rules';
import {
  type ClientDataExport,
  type CreatePrivacyRequestOutcome,
  type NewPrivacyRequest,
  type PrivacyRequestRepository,
  type PrivacyRequestView,
  type ResolvePrivacyRequestOutcome,
} from '../application/ports/privacy-request.repository';
import { type PrivacyRequestOutcome } from '../domain/privacy-request-rules';

const UNIQUE_VIOLATION = 'P2002';
const ISO_DATE_LENGTH = 10;

const REQUEST_SELECT = {
  id: true,
  clientMembershipId: true,
  kind: true,
  status: true,
  message: true,
  dueAt: true,
  createdAt: true,
  resolvedAt: true,
  resolutionNote: true,
  clientMembership: { select: { user: { select: { fullName: true } } } },
} satisfies Prisma.PrivacyRequestSelect;

type RequestRow = Prisma.PrivacyRequestGetPayload<{ select: typeof REQUEST_SELECT }>;

function toView({ clientMembership, ...row }: RequestRow): PrivacyRequestView {
  return { ...row, clientName: clientMembership.user.fullName };
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_VIOLATION;
}

async function recordNotices(
  client: TenantTransactionClient,
  request: {
    actor: ActorContext;
    kind: 'privacy_request_received' | 'privacy_request_resolved';
    recipientMembershipIds: readonly string[];
    noticeData: PrivacyNotificationData;
  },
): Promise<void> {
  const recipients = request.recipientMembershipIds.filter(
    (membershipId) => membershipId !== request.actor.membershipId,
  );
  if (recipients.length === 0) return;
  await client.notification.createMany({
    data: recipients.map((recipientMembershipId) => ({
      id: generateUuidV7(),
      centerId: request.actor.centerId,
      recipientMembershipId,
      kind: request.kind,
      data: request.noticeData,
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

const EXPORT_SELECT = {
  status: true,
  joinedAt: true,
  level: true,
  group: { select: { name: true } },
  user: { select: { fullName: true, email: true, phone: true, birthDate: true } },
  bookings: {
    orderBy: { createdAt: 'asc' },
    select: {
      status: true,
      checkedInAt: true,
      cancelledAt: true,
      classSession: { select: { startsAt: true, service: { select: { name: true } } } },
    },
  },
  receivedRoutines: {
    orderBy: { assignedAt: 'asc' },
    select: { assignedAt: true, routine: { select: { name: true } } },
  },
  privacyRequests: {
    orderBy: { createdAt: 'asc' },
    select: { kind: true, status: true, createdAt: true, resolvedAt: true },
  },
} satisfies Prisma.MembershipSelect;

type ExportRow = Prisma.MembershipGetPayload<{ select: typeof EXPORT_SELECT }>;

function toClientDataExport(membership: ExportRow): ClientDataExport {
  return {
    exportedAt: new Date(),
    person: {
      fullName: membership.user.fullName,
      email: membership.user.email,
      phone: membership.user.phone,
      birthDate: membership.user.birthDate?.toISOString().slice(0, ISO_DATE_LENGTH) ?? null,
    },
    membership: {
      status: membership.status,
      joinedAt: membership.joinedAt,
      level: membership.level,
      groupName: membership.group?.name ?? null,
    },
    bookings: membership.bookings.map((booking) => ({
      serviceName: booking.classSession.service.name,
      startsAt: booking.classSession.startsAt,
      status: booking.status,
      checkedInAt: booking.checkedInAt,
      cancelledAt: booking.cancelledAt,
    })),
    routines: membership.receivedRoutines.map(({ routine, assignedAt }) => ({
      name: routine.name,
      assignedAt,
    })),
    privacyRequests: membership.privacyRequests,
  };
}

@Injectable()
export class PrismaPrivacyRequestRepository implements PrivacyRequestRepository {
  constructor(private readonly tenantPrismaService: TenantPrismaService) {}

  async create(
    actor: ActorContext,
    request: NewPrivacyRequest,
  ): Promise<CreatePrivacyRequestOutcome> {
    try {
      return await this.tenantPrismaService.runInTenantContext(actor, async (client) => {
        const alreadyOpen = await client.privacyRequest.count({
          where: { clientMembershipId: actor.membershipId, kind: request.kind, status: 'open' },
        });
        if (alreadyOpen > 0) return { kind: 'already_open' } as const;
        const saved = await client.privacyRequest.create({
          data: { ...request, centerId: actor.centerId, clientMembershipId: actor.membershipId },
          select: REQUEST_SELECT,
        });
        await recordNotices(client, {
          actor,
          kind: 'privacy_request_received',
          recipientMembershipIds: await findAdministratorIds(client),
          noticeData: { clientName: saved.clientMembership.user.fullName, requestKind: saved.kind },
        });
        return { kind: 'created', request: toView(saved) } as const;
      });
    } catch (error) {
      // Dos pulsaciones a la vez: la segunda choca con el índice de «una abierta por derecho».
      if (isUniqueViolation(error)) return { kind: 'already_open' };
      throw error;
    }
  }

  async listMine(actor: ActorContext): Promise<PrivacyRequestView[]> {
    const rows = await this.tenantPrismaService.runInTenantContext(actor, (client) =>
      client.privacyRequest.findMany({
        where: { clientMembershipId: actor.membershipId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: REQUEST_SELECT,
      }),
    );
    return rows.map(toView);
  }

  async listForCenter(actor: ActorContext): Promise<PrivacyRequestView[]> {
    const rows = await this.tenantPrismaService.runInTenantContext(actor, (client) =>
      client.privacyRequest.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: REQUEST_SELECT,
      }),
    );
    const views = rows.map(toView);
    const open = views.filter(({ status }) => status === 'open');
    const resolved = views.filter(({ status }) => status !== 'open');
    open.sort((first, second) => first.dueAt.getTime() - second.dueAt.getTime());
    return [...open, ...resolved];
  }

  async resolve(
    actor: ActorContext,
    request: { requestId: string; outcome: PrivacyRequestOutcome; note: string | null },
  ): Promise<ResolvePrivacyRequestOutcome> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const current = await client.privacyRequest.findUnique({
        where: { id: request.requestId },
        select: { status: true, clientMembershipId: true, kind: true },
      });
      if (!current) return { kind: 'not_found' } as const;
      if (current.status !== 'open') return { kind: 'already_resolved' } as const;
      const saved = await client.privacyRequest.update({
        where: { id: request.requestId },
        data: {
          status: request.outcome,
          resolvedAt: new Date(),
          resolvedByMembershipId: actor.membershipId,
          resolutionNote: request.note,
        },
        select: REQUEST_SELECT,
      });
      await recordNotices(client, {
        actor,
        kind: 'privacy_request_resolved',
        recipientMembershipIds: [current.clientMembershipId],
        noticeData: { requestKind: current.kind, outcome: request.outcome },
      });
      return { kind: 'resolved', request: toView(saved) } as const;
    });
  }

  async exportClientData(
    actor: ActorContext,
    clientMembershipId: string,
  ): Promise<ClientDataExport | null> {
    const membership = await this.tenantPrismaService.runInTenantContext(actor, (client) =>
      client.membership.findFirst({
        where: { id: clientMembershipId, role: 'client' },
        select: EXPORT_SELECT,
      }),
    );
    return membership ? toClientDataExport(membership) : null;
  }
}
