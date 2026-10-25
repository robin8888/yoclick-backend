import { Injectable } from '@nestjs/common';
import { v7 as generateUuidV7 } from 'uuid';
import { z } from 'zod';
import { type Prisma } from '../../../generated/prisma/client';
import { type PlatformActorContext } from '../../../shared/auth/authenticated-request';
import {
  TenantPrismaService,
  type TenantTransactionClient,
} from '../../../shared/database/tenant-prisma.service';
import { buildPage, type Page } from '../../../shared/pagination/build-page';
import { decodeCursor } from '../../../shared/pagination/cursor';
import { MILLISECONDS_PER_DAY } from '../../../shared/time/time-units';
import {
  fillMonthlySeries,
  getSeriesStart,
  listRecentMonthKeys,
  type MonthlyCount,
} from '../domain/monthly-series';
import {
  type AuditListQuery,
  type CenterListQuery,
  type CenterStatus,
  type CenterUpdate,
  type PlatformAuditEntry,
  type PlatformCenterDetail,
  type PlatformCenterSummary,
  type PlatformOverview,
  type PlatformRepository,
} from '../application/ports/platform.repository';

const RECENT_DAYS = 30;
const TRIAL_WARNING_DAYS = 7;
const SERIES_MONTHS = 12;
const TEAM_ROLES = ['owner', 'admin', 'staff'] as const;
const CENTER_STATUSES: readonly CenterStatus[] = ['trial', 'active', 'past_due', 'suspended'];

const positionSchema = z.strictObject({ createdAt: z.iso.datetime(), id: z.uuid() });

interface MonthRow {
  readonly month: string;
  readonly count: bigint;
}

function daysFrom(now: Date, days: number): Date {
  return new Date(now.getTime() + days * MILLISECONDS_PER_DAY);
}

function toMonthlyCounts(rows: readonly MonthRow[]): MonthlyCount[] {
  return rows.map(({ month, count }) => ({ month, count: Number(count) }));
}

/** Las reservas que no se cancelaron con la clase en los últimos 30 días. */
function recentBookingsFilter(now: Date): Prisma.BookingWhereInput {
  return {
    status: { not: 'cancelled' },
    classSession: { startsAt: { gte: daysFrom(now, -RECENT_DAYS), lte: now } },
  };
}

type CenterRow = Prisma.CenterGetPayload<object>;

interface CenterUsage {
  readonly activeClients: Map<string, number>;
  readonly teamMembers: Map<string, number>;
  readonly recentBookings: Map<string, number>;
  readonly lastBookingAt: Map<string, Date | null>;
}

async function countMembersByCenter(
  client: TenantTransactionClient,
  centerIds: readonly string[],
): Promise<Pick<CenterUsage, 'activeClients' | 'teamMembers'>> {
  const where = { centerId: { in: [...centerIds] }, status: 'active' as const };
  const [clients, team] = await Promise.all([
    client.membership.groupBy({
      by: ['centerId'],
      where: { ...where, role: 'client' },
      _count: { _all: true },
    }),
    client.membership.groupBy({
      by: ['centerId'],
      where: { ...where, role: { in: [...TEAM_ROLES] } },
      _count: { _all: true },
    }),
  ]);
  return {
    activeClients: new Map(clients.map((row) => [row.centerId, row._count._all])),
    teamMembers: new Map(team.map((row) => [row.centerId, row._count._all])),
  };
}

async function countBookingsByCenter(
  client: TenantTransactionClient,
  centerIds: readonly string[],
  now: Date,
): Promise<Pick<CenterUsage, 'recentBookings' | 'lastBookingAt'>> {
  const inCenters = { centerId: { in: [...centerIds] } };
  const [recent, last] = await Promise.all([
    client.booking.groupBy({
      by: ['centerId'],
      where: { ...inCenters, ...recentBookingsFilter(now) },
      _count: { _all: true },
    }),
    // La última clase ya pasada con alguna reserva que no se canceló.
    client.classSession.groupBy({
      by: ['centerId'],
      where: {
        ...inCenters,
        startsAt: { lte: now },
        bookings: { some: { status: { not: 'cancelled' } } },
      },
      _max: { startsAt: true },
    }),
  ]);
  return {
    recentBookings: new Map(recent.map((row) => [row.centerId, row._count._all])),
    lastBookingAt: new Map(last.map((row) => [row.centerId, row._max.startsAt])),
  };
}

/** Cuenta por centro, solo para los centros de la página: agregados, nunca filas de personas. */
async function readCenterUsage(
  client: TenantTransactionClient,
  centerIds: readonly string[],
  now: Date,
): Promise<CenterUsage> {
  const [members, bookings] = await Promise.all([
    countMembersByCenter(client, centerIds),
    countBookingsByCenter(client, centerIds, now),
  ]);
  return { ...members, ...bookings };
}

function toSummary(center: CenterRow, usage: CenterUsage): PlatformCenterSummary {
  return {
    id: center.id,
    name: center.name,
    slug: center.slug,
    sectorId: center.sectorId,
    city: center.city,
    status: center.status,
    planId: center.planId,
    createdAt: center.createdAt,
    trialEndsAt: center.trialEndsAt,
    maxClients: center.maxClients,
    activeClientCount: usage.activeClients.get(center.id) ?? 0,
    teamMemberCount: usage.teamMembers.get(center.id) ?? 0,
    bookingsLast30Days: usage.recentBookings.get(center.id) ?? 0,
    lastBookingAt: usage.lastBookingAt.get(center.id) ?? null,
  };
}

interface OlderThanFilter {
  OR?: ({ createdAt: { lt: Date } } | { createdAt: Date; id: { lt: string } })[];
}

/** Las filas anteriores a la posición del cursor, de la más nueva a la más antigua. */
function buildOlderThanFilter(cursor: string | undefined): OlderThanFilter {
  if (cursor === undefined) return {};
  const position = decodeCursor(cursor, positionSchema);
  const createdAt = new Date(position.createdAt);
  return { OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: position.id } }] };
}

function buildCenterFilter(query: CenterListQuery): Prisma.CenterWhereInput {
  return {
    ...(query.status === undefined ? {} : { status: query.status }),
    ...(query.sectorId === undefined ? {} : { sectorId: query.sectorId }),
    ...(query.search === undefined
      ? {}
      : { name: { contains: query.search, mode: 'insensitive' as const } }),
    ...buildOlderThanFilter(query.cursor),
  };
}

/** Al asignar un plan, el centro recibe sus límites (docs/spec/17 §2.1); un tope puesto a mano a la vez manda. */
async function readPlanLimits(
  client: TenantTransactionClient,
  planId: string | undefined,
): Promise<Prisma.CenterUncheckedUpdateManyInput> {
  if (planId === undefined) return {};
  const plan = await client.platformPlan.findUniqueOrThrow({ where: { id: planId } });
  return {
    planId: plan.id,
    maxClients: plan.maxClients,
    documentStorageLimitBytes: plan.documentStorageLimitBytes,
    videoStorageLimitBytes: plan.videoStorageLimitBytes,
  };
}

async function readMonthlySeries(
  client: TenantTransactionClient,
  now: Date,
): Promise<PlatformOverview['monthly']> {
  const seriesStart = getSeriesStart(now, SERIES_MONTHS);
  const monthKeys = listRecentMonthKeys(now, SERIES_MONTHS);
  const [newCenters, bookings] = await Promise.all([
    client.$queryRaw<MonthRow[]>`
      select to_char(date_trunc('month', "created_at" at time zone 'UTC'), 'YYYY-MM') as month,
             count(*) as count
      from "centers" where "created_at" >= ${seriesStart} group by 1`,
    client.$queryRaw<MonthRow[]>`
      select to_char(date_trunc('month', cs."starts_at" at time zone 'UTC'), 'YYYY-MM') as month,
             count(*) as count
      from "bookings" b
      join "class_sessions" cs on cs."id" = b."class_session_id"
      where b."status" <> 'cancelled'::"booking_status"
        and cs."starts_at" >= ${seriesStart} and cs."starts_at" <= ${now}
      group by 1`,
  ]);
  return {
    newCenters: fillMonthlySeries(monthKeys, toMonthlyCounts(newCenters)),
    bookings: fillMonthlySeries(monthKeys, toMonthlyCounts(bookings)),
  };
}

async function readCenterTotals(
  client: TenantTransactionClient,
  now: Date,
): Promise<Pick<PlatformOverview, 'centers' | 'centersBySector'>> {
  const [byStatus, newLast30Days, trialsEnding, sectors] = await Promise.all([
    client.center.groupBy({ by: ['status'], _count: { _all: true } }),
    client.center.count({ where: { createdAt: { gte: daysFrom(now, -RECENT_DAYS) } } }),
    client.center.count({
      where: { status: 'trial', trialEndsAt: { gte: now, lte: daysFrom(now, TRIAL_WARNING_DAYS) } },
    }),
    client.center.groupBy({
      by: ['sectorId'],
      _count: { _all: true },
      orderBy: { _count: { sectorId: 'desc' } },
    }),
  ]);
  const statusCounts = new Map(byStatus.map((row) => [row.status, row._count._all]));
  const byStatusRecord = Object.fromEntries(
    CENTER_STATUSES.map((status) => [status, statusCounts.get(status) ?? 0]),
  ) as Record<CenterStatus, number>;
  return {
    centers: {
      total: CENTER_STATUSES.reduce((total, status) => total + byStatusRecord[status], 0),
      byStatus: byStatusRecord,
      newLast30Days,
      trialsEndingWithin7Days: trialsEnding,
    },
    centersBySector: sectors.map((row) => ({ sectorId: row.sectorId, count: row._count._all })),
  };
}

@Injectable()
export class PrismaPlatformRepository implements PlatformRepository {
  constructor(private readonly tenantPrismaService: TenantPrismaService) {}

  async getOverview(actor: PlatformActorContext, now: Date): Promise<PlatformOverview> {
    return this.tenantPrismaService.runInPlatformContext(actor, async (client) => {
      const [totals, clients, team, recentBookings, monthly] = await Promise.all([
        readCenterTotals(client, now),
        client.membership.count({ where: { role: 'client', status: 'active' } }),
        client.membership.count({ where: { role: { in: [...TEAM_ROLES] }, status: 'active' } }),
        client.booking.count({ where: recentBookingsFilter(now) }),
        readMonthlySeries(client, now),
      ]);
      return {
        generatedAt: now,
        ...totals,
        people: { activeClients: clients, activeTeamMembers: team },
        bookingsLast30Days: recentBookings,
        monthly,
      };
    });
  }

  async listCenters(
    actor: PlatformActorContext,
    query: CenterListQuery,
    now: Date,
  ): Promise<Page<PlatformCenterSummary>> {
    return this.tenantPrismaService.runInPlatformContext(actor, async (client) => {
      const centers = await client.center.findMany({
        where: buildCenterFilter(query),
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
      });
      const usage = await readCenterUsage(
        client,
        centers.map((center) => center.id),
        now,
      );
      return buildPage({
        fetchedRows: centers.map((center) => toSummary(center, usage)),
        limit: query.limit,
        toPosition: (last) => ({ createdAt: last.createdAt.toISOString(), id: last.id }),
      });
    });
  }

  async findCenter(
    actor: PlatformActorContext,
    centerId: string,
    now: Date,
  ): Promise<PlatformCenterDetail | null> {
    return this.tenantPrismaService.runInPlatformContext(actor, async (client) => {
      const center = await client.center.findUnique({ where: { id: centerId } });
      if (center === null) return null;
      const usage = await readCenterUsage(client, [center.id], now);
      return {
        ...toSummary(center, usage),
        timezone: center.timezone,
        disabledModules: center.disabledModules,
        stripeChargesEnabled: center.stripeChargesEnabled,
        documentStorageLimitBytes: Number(center.documentStorageLimitBytes),
        videoStorageLimitBytes:
          center.videoStorageLimitBytes === null ? null : Number(center.videoStorageLimitBytes),
        photoStorageLimitBytes: Number(center.photoStorageLimitBytes),
      };
    });
  }

  async updateCenter(update: CenterUpdate): Promise<boolean> {
    const { actor, centerId, changes, auditEntries } = update;
    return this.tenantPrismaService.runInPlatformContext(actor, async (client) => {
      const planLimits = await readPlanLimits(client, changes.planId);
      const result = await client.center.updateMany({
        where: { id: centerId },
        data: {
          ...planLimits,
          ...(changes.status === undefined ? {} : { status: changes.status }),
          ...(changes.trialEndsAt === undefined ? {} : { trialEndsAt: changes.trialEndsAt }),
          ...(changes.maxClients === undefined ? {} : { maxClients: changes.maxClients }),
          ...planLimits,
        },
      });
      if (result.count === 0) return false;
      await client.platformAuditEntry.createMany({
        data: auditEntries.map((entry) => ({
          id: generateUuidV7(),
          actorUserId: actor.userId,
          action: entry.action,
          centerId,
          details: entry.details as Prisma.InputJsonObject,
        })),
      });
      return true;
    });
  }

  async listAuditEntries(
    actor: PlatformActorContext,
    query: AuditListQuery,
  ): Promise<Page<PlatformAuditEntry>> {
    return this.tenantPrismaService.runInPlatformContext(actor, async (client) => {
      const rows = await client.platformAuditEntry.findMany({
        where: {
          ...(query.centerId === undefined ? {} : { centerId: query.centerId }),
          ...buildOlderThanFilter(query.cursor),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
      });
      return buildPage({
        fetchedRows: rows.map((row) => ({
          id: row.id,
          action: row.action,
          centerId: row.centerId,
          details: row.details as Record<string, unknown>,
          createdAt: row.createdAt,
        })),
        limit: query.limit,
        toPosition: (last) => ({ createdAt: last.createdAt.toISOString(), id: last.id }),
      });
    });
  }
}
