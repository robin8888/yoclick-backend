import { v7 as generateUuidV7 } from 'uuid';
import { type Prisma } from '../../../generated/prisma/client';
import { type TenantTransactionClient } from '../../../shared/database/tenant-prisma.service';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import {
  type EndSeriesOutcome,
  type NewScheduleSeries,
  type ScheduleSeriesCreationOutcome,
  type ScheduleSeriesPatch,
  type ScheduleSeriesUpdateOutcome,
} from '../application/ports/schedule.repository';
import { MAX_ACTIVE_SCHEDULES_PER_CENTER, resolveSessionCapacity } from '../domain/schedule-rules';
import { materializeSchedulesInTransaction, toDateColumn } from './schedule-materialization';
import { recordEnrollmentNotices } from './schedule-notices';
import { findSeriesView } from './schedule-view.mapper';
import { resolveSeriesParts, type ResolvedSeriesParts } from './series-validation';
import { cancelSessionWithBookings, listFutureSessionsOfSchedules } from './session-cancellation';

interface ScheduleRowsInput {
  readonly actor: ActorContext;
  readonly newSeries: NewScheduleSeries;
  readonly parts: Extract<ResolvedSeriesParts, { kind: 'resolved' }>;
  readonly seriesId: string;
}

/** Una fila por día de la semana, todas con la misma serie, hora, sala, persona y aforo. */
function buildScheduleRows(input: ScheduleRowsInput): Prisma.SessionScheduleCreateManyInput[] {
  const { actor, newSeries, parts } = input;
  const capacity = resolveSessionCapacity({
    mode: newSeries.mode,
    roomCapacity: parts.room?.capacity ?? null,
    requestedCapacity: newSeries.capacity,
  });
  return newSeries.weekdays.map((weekday) => ({
    id: generateUuidV7(),
    centerId: actor.centerId,
    seriesId: input.seriesId,
    roomId: parts.room?.id ?? null,
    serviceId: parts.service.id,
    staffMembershipId: parts.staffMembershipId,
    mode: newSeries.mode,
    capacity,
    weekday,
    startsAtTime: newSeries.startsAtTime,
    endsAtTime: newSeries.endsAtTime,
    startsOn: toDateColumn(newSeries.startsOn),
    endsOn: newSeries.endsOn === null ? null : toDateColumn(newSeries.endsOn),
    label: newSeries.label,
    createdByMembershipId: actor.membershipId,
  }));
}

export async function createSeriesInTransaction(
  client: TenantTransactionClient,
  actor: ActorContext,
  request: { newSeries: NewScheduleSeries; today: string },
): Promise<ScheduleSeriesCreationOutcome> {
  const { newSeries } = request;
  const activeCount = await client.sessionSchedule.count({ where: { status: 'active' } });
  if (activeCount + newSeries.weekdays.length > MAX_ACTIVE_SCHEDULES_PER_CENTER) {
    return { kind: 'limit_reached' };
  }
  const parts = await resolveSeriesParts(client, newSeries);
  if (parts.kind !== 'resolved') return { kind: parts.kind };

  const seriesId = generateUuidV7();
  const rows = buildScheduleRows({ actor, newSeries, parts, seriesId });
  await client.sessionSchedule.createMany({ data: rows });
  const skipped = await materializeSchedulesInTransaction(client, {
    today: request.today,
    scheduleIds: rows.map(({ id }) => id),
  });
  return { kind: 'created', series: await findSeriesView(client, seriesId), skipped };
}

interface ActiveSeriesRow {
  readonly id: string;
  readonly serviceId: string;
  readonly roomId: string | null;
  readonly staffMembershipId: string;
  readonly mode: 'private' | 'group';
  readonly capacity: number;
  readonly label: string | null;
  readonly endsOn: Date | null;
}

async function listActiveRows(
  client: TenantTransactionClient,
  seriesId: string,
): Promise<ActiveSeriesRow[]> {
  return client.sessionSchedule.findMany({
    where: { seriesId, status: 'active' },
    select: {
      id: true,
      serviceId: true,
      roomId: true,
      staffMembershipId: true,
      mode: true,
      capacity: true,
      label: true,
      endsOn: true,
    },
  });
}

/** Cambiar la hora, la sala o la persona rehace las sesiones futuras; lo demás solo las retoca. */
function needsRebuild(patch: ScheduleSeriesPatch): boolean {
  return (
    patch.staffMembershipId !== undefined ||
    patch.roomId !== undefined ||
    patch.startsAtTime !== undefined ||
    patch.endsAtTime !== undefined
  );
}

/** Cancela las sesiones futuras de los horarios (sin avisar: la serie sigue y se recrean), salvo las que tengan citas sueltas. */
async function cancelFutureSessions(
  client: TenantTransactionClient,
  actor: ActorContext,
  input: {
    scheduleIds: readonly string[];
    now: Date;
    reason: string;
    onlyAfter?: Date | undefined;
  },
): Promise<{ cancelledCount: number; keptCount: number }> {
  const sessions = await listFutureSessionsOfSchedules(client, {
    scheduleIds: input.scheduleIds,
    after: input.onlyAfter ?? input.now,
  });
  let cancelledCount = 0;
  let keptCount = 0;
  for (const session of sessions) {
    if (session.singleBookingCount > 0) {
      keptCount += 1;
      continue;
    }
    await cancelSessionWithBookings(client, actor, {
      session,
      reason: input.reason,
      now: input.now,
      shouldNotify: false,
    });
    cancelledCount += 1;
  }
  return { cancelledCount, keptCount };
}

async function countFutureSessionsWithSingleBookings(
  client: TenantTransactionClient,
  input: { scheduleIds: readonly string[]; after: Date },
): Promise<number> {
  const sessions = await listFutureSessionsOfSchedules(client, input);
  return sessions.filter((session) => session.singleBookingCount > 0).length;
}

type RefusedUpdate = Exclude<ScheduleSeriesUpdateOutcome, { kind: 'updated' }>;

async function findUpdateRefusal(
  client: TenantTransactionClient,
  input: { rows: readonly ActiveSeriesRow[]; patch: ScheduleSeriesPatch; now: Date },
): Promise<RefusedUpdate | null> {
  const { rows, patch } = input;
  const [first] = rows;
  if (!first) return { kind: 'not_found' };
  if (needsRebuild(patch)) {
    const parts = await resolveSeriesParts(client, {
      serviceId: first.serviceId,
      mode: first.mode,
      roomId: patch.roomId === undefined ? first.roomId : patch.roomId,
      staffMembershipId: patch.staffMembershipId ?? first.staffMembershipId,
    });
    if (parts.kind === 'staff_not_found' || parts.kind === 'room_not_found') {
      return { kind: parts.kind };
    }
    if (parts.kind !== 'resolved') return { kind: 'room_not_for_service' };
    const sessionCount = await countFutureSessionsWithSingleBookings(client, {
      scheduleIds: rows.map(({ id }) => id),
      after: input.now,
    });
    if (sessionCount > 0) return { kind: 'has_single_bookings', sessionCount };
  }
  return null;
}

/** Las sesiones futuras que siguen en pie toman el nuevo aforo, salvo las que ya tienen más gente. */
async function applyCapacityToFutureSessions(
  client: TenantTransactionClient,
  input: { scheduleIds: readonly string[]; capacity: number; now: Date },
): Promise<void> {
  const sessions = await listFutureSessionsOfSchedules(client, {
    scheduleIds: input.scheduleIds,
    after: input.now,
  });
  const resizable = sessions.filter((session) => session.bookings.length <= input.capacity);
  if (resizable.length === 0) return;
  await client.classSession.updateMany({
    where: { id: { in: resizable.map(({ id }) => id) } },
    data: { capacity: input.capacity },
  });
}

/** Los campos enviados, tal cual; lo no enviado no se toca. */
function pickSentFields(patch: ScheduleSeriesPatch): Prisma.SessionScheduleUpdateManyMutationInput {
  const sentFields = Object.entries(patch).filter(([, value]) => value !== undefined);
  return Object.fromEntries(sentFields);
}

function toScheduleUpdate(
  patch: ScheduleSeriesPatch,
): Prisma.SessionScheduleUpdateManyMutationInput {
  const { endsOn, ...otherFields } = patch;
  return {
    ...pickSentFields(otherFields),
    ...(endsOn !== undefined && { endsOn: endsOn === null ? null : toDateColumn(endsOn) }),
    // Cualquier cambio que afecte a las fechas obliga a repasar el horizonte (es idempotente).
    ...(needsRebuild(patch) || endsOn !== undefined ? { materializedUntil: null } : {}),
  };
}

/**
 * Cambiar la hora, la sala o la persona rehace todas las sesiones futuras; acortar la serie cancela
 * solo lo que queda después de la nueva fecha final. Lo demás no toca ninguna sesión.
 */
async function cancelSessionsAffectedByPatch(
  client: TenantTransactionClient,
  actor: ActorContext,
  input: { scheduleIds: readonly string[]; patch: ScheduleSeriesPatch; now: Date },
): Promise<void> {
  const { scheduleIds, patch, now } = input;
  if (needsRebuild(patch)) {
    await cancelFutureSessions(client, actor, { scheduleIds, now, reason: 'rescheduled' });
    return;
  }
  if (patch.endsOn === undefined || patch.endsOn === null) return;
  const dayAfterEnd = toDateColumn(patch.endsOn);
  dayAfterEnd.setUTCDate(dayAfterEnd.getUTCDate() + 1);
  await cancelFutureSessions(client, actor, {
    scheduleIds,
    now,
    reason: 'ended',
    onlyAfter: dayAfterEnd,
  });
}

export async function updateSeriesInTransaction(
  client: TenantTransactionClient,
  actor: ActorContext,
  request: { seriesId: string; patch: ScheduleSeriesPatch; now: Date; today: string },
): Promise<ScheduleSeriesUpdateOutcome> {
  const rows = await listActiveRows(client, request.seriesId);
  const refusal = await findUpdateRefusal(client, { rows, patch: request.patch, now: request.now });
  if (refusal !== null) return refusal;
  const scheduleIds = rows.map(({ id }) => id);
  const { patch } = request;

  await cancelSessionsAffectedByPatch(client, actor, { scheduleIds, patch, now: request.now });
  await client.sessionSchedule.updateMany({
    where: { id: { in: scheduleIds } },
    data: toScheduleUpdate(patch),
  });
  if (patch.capacity !== undefined && !needsRebuild(patch)) {
    await applyCapacityToFutureSessions(client, {
      scheduleIds,
      capacity: patch.capacity,
      now: request.now,
    });
  }
  const skipped = await materializeSchedulesInTransaction(client, {
    today: request.today,
    scheduleIds,
  });
  return { kind: 'updated', series: await findSeriesView(client, request.seriesId), skipped };
}

export async function endSeriesInTransaction(
  client: TenantTransactionClient,
  actor: ActorContext,
  request: { seriesId: string; now: Date },
): Promise<EndSeriesOutcome> {
  const rows = await listActiveRows(client, request.seriesId);
  if (rows.length === 0) return { kind: 'not_found' };
  const scheduleIds = rows.map(({ id }) => id);
  const series = await findSeriesView(client, request.seriesId);
  const { keptCount } = await cancelFutureSessions(client, actor, {
    scheduleIds,
    now: request.now,
    reason: 'ended',
  });
  await client.sessionSchedule.updateMany({
    where: { id: { in: scheduleIds } },
    data: { status: 'ended' },
  });
  const enrollments = await client.scheduleEnrollment.findMany({
    where: { seriesId: request.seriesId, status: 'active' },
    select: { clientMembershipId: true },
  });
  await client.scheduleEnrollment.updateMany({
    where: { seriesId: request.seriesId, status: 'active' },
    data: { status: 'ended', endedAt: request.now },
  });
  await recordEnrollmentNotices(client, actor, {
    kind: 'schedule_unenrolled',
    clientMembershipIds: enrollments.map(({ clientMembershipId }) => clientMembershipId),
    series,
  });
  return { kind: 'ended', keptSessionCount: keptCount };
}
