import { type Prisma } from '../../../generated/prisma/client';
import { toSessionLocation } from '../../../shared/location/session-location';
import { type TenantTransactionClient } from '../../../shared/database/tenant-prisma.service';
import {
  type EnrollmentView,
  type ScheduleSeriesView,
} from '../application/ports/schedule.repository';
import { type ScheduleWeekday } from '../domain/schedule-rules';
import { toDateOnly } from './schedule-materialization';

export const SCHEDULE_VIEW_INCLUDE = {
  service: { select: { id: true, name: true, color: true } },
  staffMembership: { select: { id: true, user: { select: { fullName: true } } } },
  room: { select: { id: true, name: true } },
} satisfies Prisma.SessionScheduleInclude;

export type StoredScheduleRow = Prisma.SessionScheduleGetPayload<{
  include: typeof SCHEDULE_VIEW_INCLUDE;
}>;

function toSeriesView(
  rows: readonly StoredScheduleRow[],
  enrolledCount: number,
): ScheduleSeriesView | null {
  const [first] = rows;
  if (!first) return null;
  return {
    seriesId: first.seriesId,
    label: first.label,
    mode: first.mode,
    capacity: first.capacity,
    status: first.status,
    startsOn: toDateOnly(first.startsOn),
    endsOn: first.endsOn === null ? null : toDateOnly(first.endsOn),
    service: first.service,
    staff:
      first.staffMembership === null
        ? null
        : {
            membershipId: first.staffMembership.id,
            fullName: first.staffMembership.user.fullName,
          },
    room: first.room,
    location: toSessionLocation(first),
    days: [...rows]
      .sort((left, right) => left.weekday - right.weekday)
      .map((row) => ({
        scheduleId: row.id,
        weekday: row.weekday as ScheduleWeekday,
        startsAtTime: row.startsAtTime,
        endsAtTime: row.endsAtTime,
      })),
    enrolledCount,
  };
}

async function countActiveEnrollments(
  client: TenantTransactionClient,
  seriesIds: readonly string[],
): Promise<Map<string, number>> {
  const counts = await client.scheduleEnrollment.groupBy({
    by: ['seriesId'],
    where: { seriesId: { in: [...seriesIds] }, status: 'active' },
    _count: { _all: true },
  });
  return new Map(counts.map((count) => [count.seriesId, count._count._all]));
}

/** Agrupa las filas (una por día de la semana) en series, con sus matriculados. */
export async function listSeriesViews(
  client: TenantTransactionClient,
  rows: readonly StoredScheduleRow[],
): Promise<ScheduleSeriesView[]> {
  const rowsBySeries = new Map<string, StoredScheduleRow[]>();
  for (const row of rows) {
    rowsBySeries.set(row.seriesId, [...(rowsBySeries.get(row.seriesId) ?? []), row]);
  }
  const enrolledCounts = await countActiveEnrollments(client, [...rowsBySeries.keys()]);
  return [...rowsBySeries.entries()]
    .map(([seriesId, seriesRows]) => toSeriesView(seriesRows, enrolledCounts.get(seriesId) ?? 0))
    .filter((view): view is ScheduleSeriesView => view !== null);
}

export async function findSeriesView(
  client: TenantTransactionClient,
  seriesId: string,
): Promise<ScheduleSeriesView> {
  const rows = await client.sessionSchedule.findMany({
    where: { seriesId },
    include: SCHEDULE_VIEW_INCLUDE,
    orderBy: [{ weekday: 'asc' }],
  });
  const [view] = await listSeriesViews(client, rows);
  if (!view) throw new Error(`Schedule series ${seriesId} has no rows`);
  return view;
}

export const ENROLLMENT_VIEW_INCLUDE = {
  clientMembership: { select: { id: true, user: { select: { fullName: true } } } },
} satisfies Prisma.ScheduleEnrollmentInclude;

type StoredEnrollment = Prisma.ScheduleEnrollmentGetPayload<{
  include: typeof ENROLLMENT_VIEW_INCLUDE;
}>;

export function toEnrollmentView(enrollment: StoredEnrollment): EnrollmentView {
  return {
    id: enrollment.id,
    client: {
      membershipId: enrollment.clientMembership.id,
      fullName: enrollment.clientMembership.user.fullName,
    },
    startsOn: toDateOnly(enrollment.startsOn),
    endsOn: enrollment.endsOn === null ? null : toDateOnly(enrollment.endsOn),
    status: enrollment.status,
    createdAt: enrollment.createdAt,
  };
}
