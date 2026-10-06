import { Injectable } from '@nestjs/common';
import { type Prisma } from '../../../generated/prisma/client';
import {
  TenantPrismaService,
  type TenantTransactionClient,
} from '../../../shared/database/tenant-prisma.service';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import {
  type ClientChange,
  type ClientListQuery,
  type ClientListResult,
  type ClientRepository,
  type ClientUpdateOutcome,
  type ClientView,
} from '../application/ports/client.repository';
import { resolveClientActivity } from '../domain/client-activity';

const LISTED_STATUSES = ['active', 'blocked'] as const;

const WITH_USER_AND_GROUP = {
  user: { select: { fullName: true, email: true } },
  group: { select: { id: true, name: true } },
} satisfies Prisma.MembershipInclude;

type MembershipWithUserAndGroup = Prisma.MembershipGetPayload<{
  include: typeof WITH_USER_AND_GROUP;
}>;

interface BookingStats {
  readonly bookingCount: number;
  readonly lastBookingAt: Date | null;
  readonly nextBookingAt: Date | null;
}

interface StatsScope {
  readonly now: Date;
  /** Solo las citas con esa persona del equipo; `null` = todas. */
  readonly staffMembershipId: string | null;
}

/** Citas no canceladas de cada cliente: cuántas y cuál es la más reciente o próxima. */
async function loadBookingStats(
  client: TenantTransactionClient,
  scope: StatsScope,
): Promise<Map<string, BookingStats & { membershipId: string }>> {
  const rows = await client.$queryRaw<(BookingStats & { membershipId: string })[]>`
    select b.client_membership_id::text as "membershipId",
           count(*)::int as "bookingCount",
           max(cs.starts_at) as "lastBookingAt",
           min(cs.starts_at) filter (where cs.starts_at > ${scope.now}::timestamptz) as "nextBookingAt"
    from bookings b
    join class_sessions cs on cs.id = b.class_session_id
    where b.status <> 'cancelled'
      and (${scope.staffMembershipId}::uuid is null
           or cs.staff_membership_id = ${scope.staffMembershipId}::uuid)
    group by b.client_membership_id`;
  return new Map(rows.map((row) => [row.membershipId, row]));
}

function toClientView(
  membership: MembershipWithUserAndGroup,
  stats: BookingStats | undefined,
  now: Date,
): ClientView {
  const lastBookingAt = stats?.lastBookingAt ?? null;
  return {
    membershipId: membership.id,
    fullName: membership.user.fullName,
    email: membership.user.email,
    status: membership.status === 'blocked' ? 'blocked' : 'active',
    activity: resolveClientActivity({ joinedAt: membership.joinedAt, lastBookingAt, now }),
    level: membership.level,
    group: membership.group,
    joinedAt: membership.joinedAt,
    bookingCount: stats?.bookingCount ?? 0,
    lastBookingAt,
    nextBookingAt: stats?.nextBookingAt ?? null,
  };
}

function buildListFilter(query: ClientListQuery): Prisma.MembershipWhereInput {
  const contains = { contains: query.search ?? '', mode: 'insensitive' } as const;
  return {
    ...(query.search !== null && {
      OR: [{ user: { fullName: contains } }, { user: { email: contains } }],
    }),
    ...(query.groupId !== null && { groupId: query.groupId }),
  };
}

function matchesStatusFilter(view: ClientView, status: ClientListQuery['status']): boolean {
  if (status === null) return true;
  if (status === 'blocked') return view.status === 'blocked';
  return view.status === 'active' && view.activity === status;
}

async function findClientViews(
  client: TenantTransactionClient,
  where: Prisma.MembershipWhereInput,
  scope: StatsScope,
): Promise<ClientView[]> {
  const [memberships, stats] = await Promise.all([
    client.membership.findMany({
      where: { role: 'client', status: { in: [...LISTED_STATUSES] }, ...where },
      include: WITH_USER_AND_GROUP,
      orderBy: [{ user: { fullName: 'asc' } }, { id: 'asc' }],
    }),
    loadBookingStats(client, scope),
  ]);
  const views = memberships.map((membership) =>
    toClientView(membership, stats.get(membership.id), scope.now),
  );
  // Una profesional solo conoce a quienes han reservado con ella.
  return scope.staffMembershipId === null ? views : views.filter((view) => view.bookingCount > 0);
}

@Injectable()
export class PrismaClientRepository implements ClientRepository {
  constructor(private readonly tenantPrismaService: TenantPrismaService) {}

  async listClients(actor: ActorContext, query: ClientListQuery): Promise<ClientListResult> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const scope = { now: query.now, staffMembershipId: query.staffMembershipId };
      const [views, allViews] = await Promise.all([
        findClientViews(client, buildListFilter(query), scope),
        findClientViews(client, {}, scope),
      ]);
      const totalClientCount = allViews.length;
      const matching = views.filter((view) => matchesStatusFilter(view, query.status));
      return {
        totalClientCount,
        matchingCount: matching.length,
        clients: matching.slice(query.offset, query.offset + query.limit),
      };
    });
  }

  async findClient(
    actor: ActorContext,
    membershipId: string,
    now: Date,
  ): Promise<ClientView | null> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const [found] = await findClientViews(
        client,
        { id: membershipId },
        { now, staffMembershipId: null },
      );
      return found ?? null;
    });
  }

  async updateClient(
    actor: ActorContext,
    { membershipId, patch, now }: ClientChange,
  ): Promise<ClientUpdateOutcome> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const [existing] = await findClientViews(
        client,
        { id: membershipId },
        { now, staffMembershipId: null },
      );
      if (!existing) return { kind: 'not_found' };
      // La RLS acota a este centro: un grupo de otro centro simplemente no se encuentra.
      if (
        typeof patch.groupId === 'string' &&
        (await client.clientGroup.count({ where: { id: patch.groupId, archivedAt: null } })) !== 1
      ) {
        return { kind: 'unknown_group' };
      }
      await client.membership.update({
        where: { id: membershipId },
        data: {
          ...(patch.level !== undefined && { level: patch.level }),
          ...(patch.groupId !== undefined && { groupId: patch.groupId }),
        },
      });
      const [saved] = await findClientViews(
        client,
        { id: membershipId },
        { now, staffMembershipId: null },
      );
      return saved ? { kind: 'saved', client: saved } : { kind: 'not_found' };
    });
  }
}
