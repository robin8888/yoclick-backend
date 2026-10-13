import { type TenantTransactionClient } from '../../../shared/database/tenant-prisma.service';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { addDaysToLocalDate } from '../../../shared/time/zoned-time';
import {
  type NewScheduleSeries,
  type RepeatWeekOutcome,
  type SkippedOccurrence,
} from '../application/ports/schedule.repository';
import { type ScheduleWeekday } from '../domain/schedule-rules';
import { toDateColumn, toDateOnly } from './schedule-materialization';
import { createSeriesInTransaction } from './series-writes';

const DAYS_PER_WEEK = 7;
const LAST_DAY_OFFSET = 6;

type WeekRow = Awaited<ReturnType<typeof listRowsOfWeek>>[number];

/** Los horarios que empiezan y terminan dentro de esa semana: son «la semana configurada». */
async function listRowsOfWeek(client: TenantTransactionClient, weekStart: string) {
  return client.sessionSchedule.findMany({
    where: {
      status: 'active',
      startsOn: { gte: toDateColumn(weekStart) },
      endsOn: { not: null, lte: toDateColumn(addDaysToLocalDate(weekStart, LAST_DAY_OFFSET)) },
    },
    orderBy: [{ seriesId: 'asc' }, { weekday: 'asc' }],
  });
}

function groupBySeries(rows: readonly WeekRow[]): WeekRow[][] {
  const groups = new Map<string, WeekRow[]>();
  for (const row of rows) groups.set(row.seriesId, [...(groups.get(row.seriesId) ?? []), row]);
  return [...groups.values()];
}

/** La misma serie una semana más tarde: mismo servicio, sala, profesor, horas, modo y aforo. */
function buildNextWeekSeries(rows: readonly WeekRow[]): NewScheduleSeries | null {
  const [first] = rows;
  if (first === undefined || first.endsOn === null) return null;
  return {
    serviceId: first.serviceId,
    staffMembershipId: first.staffMembershipId,
    roomId: first.roomId,
    mode: first.mode,
    capacity: first.capacity,
    weekdays: rows.map((row) => row.weekday as ScheduleWeekday),
    startsAtTime: first.startsAtTime,
    endsAtTime: first.endsAtTime,
    startsOn: addDaysToLocalDate(toDateOnly(first.startsOn), DAYS_PER_WEEK),
    endsOn: addDaysToLocalDate(toDateOnly(first.endsOn), DAYS_PER_WEEK),
    label: first.label,
  };
}

/** Ya hay un horario igual esa semana (se pulsó dos veces): no se duplica. */
async function existsAlready(
  client: TenantTransactionClient,
  copy: NewScheduleSeries,
): Promise<boolean> {
  const existing = await client.sessionSchedule.count({
    where: {
      status: 'active',
      serviceId: copy.serviceId,
      roomId: copy.roomId,
      ...(copy.staffMembershipId === null ? {} : { staffMembershipId: copy.staffMembershipId }),
      startsAtTime: copy.startsAtTime,
      endsAtTime: copy.endsAtTime,
      startsOn: toDateColumn(copy.startsOn),
      weekday: { in: [...copy.weekdays] },
    },
  });
  return existing > 0;
}

/**
 * Copia la semana configurada a la siguiente con un solo gesto: cada horario de esa semana se crea
 * otra vez, siete días después, con el mismo servicio, sala, profesor, horas y aforo. Lo que choca
 * (festivo, sala o profesor ocupados, sala bloqueada) se salta y se cuenta.
 */
export async function repeatWeekInTransaction(
  client: TenantTransactionClient,
  actor: ActorContext,
  request: { weekStart: string; today: string },
): Promise<RepeatWeekOutcome> {
  const outcome = {
    copiedSeriesCount: 0,
    alreadyCopiedSeriesCount: 0,
    failedSeriesCount: 0,
    skipped: [] as SkippedOccurrence[],
  };
  const groups = groupBySeries(await listRowsOfWeek(client, request.weekStart));

  for (const rows of groups) {
    const copy = buildNextWeekSeries(rows);
    if (copy === null) continue;
    if (await existsAlready(client, copy)) {
      outcome.alreadyCopiedSeriesCount += 1;
      continue;
    }
    const created = await createSeriesInTransaction(client, actor, {
      newSeries: copy,
      today: request.today,
    });
    if (created.kind === 'created') {
      outcome.copiedSeriesCount += 1;
      outcome.skipped.push(...created.skipped);
    } else {
      outcome.failedSeriesCount += 1;
    }
  }
  return outcome;
}
