import { v7 as generateUuidV7 } from 'uuid';
import { type Prisma } from '../../../generated/prisma/client';
import { type TenantTransactionClient } from '../../../shared/database/tenant-prisma.service';
import {
  toLocationColumns,
  toSessionLocation,
  isSameLocation,
} from '../../../shared/location/session-location';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { type SessionLocation } from '../../../shared/location/session-location';
import {
  type EndSeriesOutcome,
  type NewScheduleSeries,
  type ScheduleSeriesCreationOutcome,
  type ScheduleSeriesPatch,
  type ScheduleSeriesUpdateOutcome,
} from '../application/ports/schedule.repository';
import { MAX_ACTIVE_SCHEDULES_PER_CENTER, resolveSessionCapacity } from '../domain/schedule-rules';
import {
  materializeSchedulesInTransaction,
  toDateColumn,
  toDateOnly,
} from './schedule-materialization';
import { recordEnrollmentNotices } from './schedule-notices';
import { findScheduleOverlap, type ScheduleCandidate } from './schedule-overlap';
import { findSeriesView } from './schedule-view.mapper';
import { resolveSeriesParts, type ResolvedSeriesParts } from './series-validation';
import { cancelSessionWithBookings, listFutureSessionsOfSchedules } from './session-cancellation';

const emptyColumns = {
  locationName: null,
  locationAddress: null,
  locationLatitude: null,
  locationLongitude: null,
} as const;

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
    ...toLocationColumns(newSeries.location),
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

  const overlap = await findScheduleOverlap(client, {
    roomId: parts.room?.id ?? null,
    staffMembershipId: parts.staffMembershipId,
    weekdays: newSeries.weekdays,
    startsAtTime: newSeries.startsAtTime,
    endsAtTime: newSeries.endsAtTime,
    startsOn: newSeries.startsOn,
    endsOn: newSeries.endsOn,
  });
  if (overlap !== null) return { kind: overlap };

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
  readonly seriesId: string;
  readonly weekday: number;
  readonly startsAtTime: string;
  readonly endsAtTime: string;
  readonly startsOn: Date;
  readonly serviceId: string;
  readonly roomId: string | null;
  readonly staffMembershipId: string | null;
  readonly mode: 'private' | 'group';
  readonly capacity: number;
  readonly label: string | null;
  readonly endsOn: Date | null;
  readonly locationName: string | null;
  readonly locationAddress: string | null;
  readonly locationLatitude: number | null;
  readonly locationLongitude: number | null;
}

async function listActiveRows(
  client: TenantTransactionClient,
  seriesId: string,
): Promise<ActiveSeriesRow[]> {
  return client.sessionSchedule.findMany({
    where: { seriesId, status: 'active' },
    select: {
      id: true,
      seriesId: true,
      weekday: true,
      startsAtTime: true,
      endsAtTime: true,
      startsOn: true,
      serviceId: true,
      roomId: true,
      staffMembershipId: true,
      mode: true,
      capacity: true,
      label: true,
      endsOn: true,
      locationName: true,
      locationAddress: true,
      locationLatitude: true,
      locationLongitude: true,
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
    if (
      parts.kind === 'staff_not_found' ||
      parts.kind === 'room_not_found' ||
      parts.kind === 'staff_not_for_service'
    ) {
      return { kind: parts.kind };
    }
    if (parts.kind !== 'resolved') return { kind: 'room_not_for_service' };
    const sessionCount = await countFutureSessionsWithSingleBookings(client, {
      scheduleIds: rows.map(({ id }) => id),
      after: input.now,
    });
    if (sessionCount > 0) return { kind: 'has_single_bookings', sessionCount };
  }
  return findOverlapOfUpdate(client, { rows, patch });
}

/** La fecha final tras el cambio: la nueva si se envió (incluso «sin fin») o la que ya tenía. */
function resolveEndsOn(first: ActiveSeriesRow, patch: ScheduleSeriesPatch): string | null {
  if (patch.endsOn !== undefined) return patch.endsOn;
  return first.endsOn === null ? null : toDateOnly(first.endsOn);
}

/** El horario tal como quedaría tras el cambio. */
function buildEditedCandidate(
  rows: readonly ActiveSeriesRow[],
  first: ActiveSeriesRow,
  patch: ScheduleSeriesPatch,
): ScheduleCandidate {
  return {
    roomId: patch.roomId === undefined ? first.roomId : patch.roomId,
    staffMembershipId: patch.staffMembershipId ?? first.staffMembershipId,
    weekdays: rows.map(({ weekday }) => weekday),
    startsAtTime: patch.startsAtTime ?? first.startsAtTime,
    endsAtTime: patch.endsAtTime ?? first.endsAtTime,
    startsOn: toDateOnly(first.startsOn),
    endsOn: resolveEndsOn(first, patch),
    excludeSeriesId: first.seriesId,
  };
}

/** El horario editado no puede pisar a otro de la misma sala ni de la misma persona. */
async function findOverlapOfUpdate(
  client: TenantTransactionClient,
  input: { rows: readonly ActiveSeriesRow[]; patch: ScheduleSeriesPatch },
): Promise<RefusedUpdate | null> {
  const { rows, patch } = input;
  const [first] = rows;
  if (!first || !(needsRebuild(patch) || patch.endsOn !== undefined)) return null;
  const overlap = await findScheduleOverlap(client, buildEditedCandidate(rows, first, patch));
  return overlap === null ? null : { kind: overlap };
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

/** Quien está matriculado y quien da la clase (antes y ahora) se entera de que el horario cambió. */
async function notifyScheduleChanged(
  client: TenantTransactionClient,
  actor: ActorContext,
  input: {
    seriesId: string;
    series: Awaited<ReturnType<typeof findSeriesView>>;
    previousStaffMembershipIds: readonly (string | null)[];
    placeName: string | undefined;
  },
): Promise<void> {
  const enrollments = await client.scheduleEnrollment.findMany({
    where: { seriesId: input.seriesId, status: 'active' },
    select: { clientMembershipId: true },
  });
  const staffIds = [input.series.staff?.membershipId, ...input.previousStaffMembershipIds];
  const recipients = new Set([
    ...enrollments.map(({ clientMembershipId }) => clientMembershipId),
    ...staffIds.filter((id): id is string => id !== undefined && id !== null),
  ]);
  await recordEnrollmentNotices(client, actor, {
    kind: 'schedule_updated',
    clientMembershipIds: [...recipients],
    placeName: input.placeName,
    series: input.series,
  });
}

/** Pone la nueva ubicación en el horario y en sus sesiones futuras (las de otro día cambiado a mano también). */
async function applySeriesLocation(
  client: TenantTransactionClient,
  input: { scheduleIds: readonly string[]; location: SessionLocation | null; now: Date },
): Promise<void> {
  const columns = toLocationColumns(input.location);
  await client.sessionSchedule.updateMany({
    where: { id: { in: [...input.scheduleIds] } },
    data: columns,
  });
  await client.classSession.updateMany({
    where: {
      scheduleId: { in: [...input.scheduleIds] },
      status: 'scheduled',
      startsAt: { gt: input.now },
    },
    data: columns,
  });
}

/** El aforo y la ubicación se ponen en las sesiones que ya existen; lo demás las rehace. */
async function applyChangesToFutureSessions(
  client: TenantTransactionClient,
  input: {
    scheduleIds: readonly string[];
    patch: ScheduleSeriesPatch;
    location: SessionLocation | null | undefined;
    now: Date;
  },
): Promise<void> {
  const { scheduleIds, patch, location, now } = input;
  if (patch.capacity !== undefined && !needsRebuild(patch)) {
    await applyCapacityToFutureSessions(client, { scheduleIds, capacity: patch.capacity, now });
  }
  if (location !== undefined) await applySeriesLocation(client, { scheduleIds, location, now });
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
  const { location, ...patch } = request.patch;
  const isLocationChanged =
    location !== undefined && !isSameLocation(location, toSessionLocation(rows[0] ?? emptyColumns));

  await cancelSessionsAffectedByPatch(client, actor, { scheduleIds, patch, now: request.now });
  await client.sessionSchedule.updateMany({
    where: { id: { in: scheduleIds } },
    data: toScheduleUpdate(patch),
  });
  await applyChangesToFutureSessions(client, { scheduleIds, patch, location, now: request.now });
  const skipped = await materializeSchedulesInTransaction(client, {
    today: request.today,
    scheduleIds,
  });
  const series = await findSeriesView(client, request.seriesId);
  if (needsRebuild(patch) || isLocationChanged) {
    await notifyScheduleChanged(client, actor, {
      seriesId: request.seriesId,
      series,
      previousStaffMembershipIds: rows.map(({ staffMembershipId }) => staffMembershipId),
      // Si cambia más que el lugar, el aviso habla del horario; si solo cambia el lugar, dice el sitio.
      placeName: needsRebuild(patch) ? undefined : (location?.name ?? ''),
    });
  }
  return { kind: 'updated', series, skipped };
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
