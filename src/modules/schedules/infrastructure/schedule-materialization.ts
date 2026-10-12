import { v7 as generateUuidV7 } from 'uuid';
import { type TenantTransactionClient } from '../../../shared/database/tenant-prisma.service';
import {
  addDaysToLocalDate,
  toLocalDate,
  zonedDateTimeToUtc,
} from '../../../shared/time/zoned-time';
import { hasOverlappingBooking } from '../../bookings/infrastructure/client-overlap';
import {
  findSkipReason,
  listOccurrenceDates,
  MATERIALIZATION_HORIZON_DAYS,
  resolvePendingWindow,
  type AbsencePeriod,
  type DateWindow,
  type ScheduleWeekday,
} from '../domain/schedule-rules';
import { type SkippedOccurrence } from '../application/ports/schedule.repository';
import { isRoomBlocked } from './room-block-queries';

const UTC_MIDNIGHT_SUFFIX = 'T00:00:00Z';
const ISO_DATE_LENGTH = 10;

export function toDateOnly(value: Date): string {
  return value.toISOString().slice(0, ISO_DATE_LENGTH);
}

export function toDateColumn(localDate: string): Date {
  return new Date(localDate + UTC_MIDNIGHT_SUFFIX);
}

export interface CenterCalendar {
  readonly timeZone: string;
  readonly holidayDates: readonly string[];
}

export async function loadCenterCalendar(client: TenantTransactionClient): Promise<CenterCalendar> {
  const center = await client.center.findFirstOrThrow({
    select: { timezone: true, holidays: true },
  });
  // Ajustes escritos por esta API tras validarlos con zod.
  const holidayDates = ((center.holidays ?? []) as { date: string }[]).map(({ date }) => date);
  return { timeZone: center.timezone, holidayDates };
}

/** La fecha local del centro en la que cae un instante: el «hoy» desde el que se cuentan las 8 semanas. */
export async function resolveLocalToday(
  client: TenantTransactionClient,
  now: Date,
): Promise<string> {
  const center = await client.center.findFirstOrThrow({ select: { timezone: true } });
  return toLocalDate(now, center.timezone);
}

async function listAbsences(
  client: TenantTransactionClient,
  input: { staffMembershipId: string; window: DateWindow },
): Promise<AbsencePeriod[]> {
  const absences = await client.staffAbsence.findMany({
    where: {
      membershipId: input.staffMembershipId,
      startsOn: { lte: toDateColumn(input.window.toDate) },
      endsOn: { gte: toDateColumn(input.window.fromDate) },
    },
    select: { startsOn: true, endsOn: true },
  });
  return absences.map(({ startsOn, endsOn }) => ({
    startsOn: toDateOnly(startsOn),
    endsOn: toDateOnly(endsOn),
  }));
}

interface StoredSchedule {
  readonly id: string;
  readonly centerId: string;
  readonly seriesId: string;
  readonly roomId: string | null;
  readonly serviceId: string;
  readonly staffMembershipId: string;
  readonly mode: 'private' | 'group';
  readonly capacity: number;
  readonly weekday: number;
  readonly startsAtTime: string;
  readonly endsAtTime: string;
  readonly startsOn: Date;
  readonly endsOn: Date | null;
  readonly materializedUntil: Date | null;
}

interface NewScheduledSession {
  readonly schedule: StoredSchedule;
  readonly date: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

type InsertOutcome = 'inserted' | 'exists' | 'conflict';

/**
 * Inserta la sesión del horario para esa fecha. La clave única (horario, inicio) hace idempotente
 * la materialización; la restricción EXCLUDE de sala y profesor la convierte en «conflicto» cuando
 * ya hay otra cosa a esa hora. `ON CONFLICT DO NOTHING` cubre las dos sin abortar la transacción.
 */
async function insertSession(
  client: TenantTransactionClient,
  session: NewScheduledSession,
  cancelledReason: string | null,
): Promise<InsertOutcome> {
  const { schedule } = session;
  const existing = await client.classSession.findFirst({
    where: { scheduleId: schedule.id, startsAt: session.startsAt },
    select: { id: true },
  });
  if (existing) return 'exists';
  const status = cancelledReason === null ? 'scheduled' : 'cancelled';
  const inserted = await client.$queryRaw<{ id: string }[]>`
    insert into class_sessions
      (id, center_id, service_id, staff_membership_id, starts_at, ends_at, room_id, mode, capacity,
       schedule_id, status, cancelled_reason)
    values (${generateUuidV7()}::uuid, ${schedule.centerId}::uuid, ${schedule.serviceId}::uuid,
            ${schedule.staffMembershipId}::uuid, ${session.startsAt}::timestamptz,
            ${session.endsAt}::timestamptz, ${schedule.roomId}::uuid, ${schedule.mode}::session_mode,
            ${schedule.capacity}, ${schedule.id}::uuid, ${status}::class_session_status,
            ${cancelledReason})
    on conflict do nothing
    returning id`;
  return inserted.length === 1 ? 'inserted' : 'conflict';
}

/** Las matrículas activas de la serie que cubren esa fecha, con quién las hizo (para «quién asignó»). */
async function listEnrollmentsOfDate(
  client: TenantTransactionClient,
  input: { seriesId: string; date: string },
) {
  return client.scheduleEnrollment.findMany({
    where: {
      seriesId: input.seriesId,
      status: 'active',
      startsOn: { lte: toDateColumn(input.date) },
      OR: [{ endsOn: null }, { endsOn: { gte: toDateColumn(input.date) } }],
    },
    select: {
      id: true,
      clientMembershipId: true,
      createdByMembershipId: true,
      createdBy: { select: { role: true } },
    },
  });
}

/** La plaza de cada persona matriculada en una sesión recién creada; quien ya tiene otra cita a esa hora se salta. */
export async function createEnrollmentBookings(
  client: TenantTransactionClient,
  input: {
    seriesId: string;
    centerId: string;
    sessionId: string;
    date: string;
    startsAt: Date;
    endsAt: Date;
  },
): Promise<void> {
  const enrollments = await listEnrollmentsOfDate(client, input);
  for (const enrollment of enrollments) {
    const isBusy = await hasOverlappingBooking(client, {
      clientMembershipId: enrollment.clientMembershipId,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
    });
    if (isBusy) continue;
    await client.booking.create({
      data: {
        id: generateUuidV7(),
        centerId: input.centerId,
        classSessionId: input.sessionId,
        clientMembershipId: enrollment.clientMembershipId,
        status: 'confirmed',
        source: 'enrollment',
        enrollmentId: enrollment.id,
        createdByMembershipId: enrollment.createdByMembershipId,
        createdByRole: enrollment.createdBy.role,
      },
    });
  }
}

interface MaterializationContext {
  readonly calendar: CenterCalendar;
  readonly window: DateWindow;
  readonly absences: readonly AbsencePeriod[];
}

/** Por qué el horario no puede ocurrir ese día antes siquiera de intentarlo: cierre, ausencia o sala bloqueada. */
async function findBlockingReason(
  client: TenantTransactionClient,
  session: NewScheduledSession,
  context: MaterializationContext,
): Promise<SkippedOccurrence['reason'] | null> {
  const skipReason = findSkipReason({
    date: session.date,
    holidayDates: context.calendar.holidayDates,
    absences: context.absences,
  });
  if (skipReason !== null) return skipReason;
  const { roomId } = session.schedule;
  if (roomId === null) return null;
  const isBlocked = await isRoomBlocked(client, {
    roomId,
    startsAt: session.startsAt,
    endsAt: session.endsAt,
  });
  return isBlocked ? 'blocked' : null;
}

/** La sesión del día recién creada recibe la plaza de cada persona matriculada. */
async function attachEnrollments(
  client: TenantTransactionClient,
  session: NewScheduledSession,
): Promise<void> {
  const { schedule } = session;
  const created = await client.classSession.findFirstOrThrow({
    where: { scheduleId: schedule.id, startsAt: session.startsAt },
    select: { id: true },
  });
  await createEnrollmentBookings(client, {
    seriesId: schedule.seriesId,
    centerId: schedule.centerId,
    sessionId: created.id,
    date: session.date,
    startsAt: session.startsAt,
    endsAt: session.endsAt,
  });
}

async function materializeDate(
  client: TenantTransactionClient,
  schedule: StoredSchedule,
  input: { date: string; context: MaterializationContext },
): Promise<SkippedOccurrence | null> {
  const { date, context } = input;
  const { timeZone } = context.calendar;
  const session: NewScheduledSession = {
    schedule,
    date,
    startsAt: zonedDateTimeToUtc(date, schedule.startsAtTime, timeZone),
    endsAt: zonedDateTimeToUtc(date, schedule.endsAtTime, timeZone),
  };
  const skipped = (reason: SkippedOccurrence['reason']): SkippedOccurrence => ({
    date,
    startsAtTime: schedule.startsAtTime,
    reason,
  });
  const blockingReason = await findBlockingReason(client, session, context);
  if (blockingReason !== null) {
    await insertSession(client, session, blockingReason);
    return skipped(blockingReason);
  }
  const outcome = await insertSession(client, session, null);
  if (outcome === 'exists') return null;
  if (outcome === 'conflict') {
    await insertSession(client, session, 'conflict');
    return skipped('conflict');
  }
  await attachEnrollments(client, session);
  return null;
}

/** Serializa la materialización de un horario: dos peticiones a la vez no crean sesiones de más. */
async function lockSchedule(client: TenantTransactionClient, scheduleId: string): Promise<void> {
  await client.$executeRaw`select pg_advisory_xact_lock(hashtextextended(${scheduleId}, 2))`;
}

/** Crea las sesiones que faltan de un horario hasta el horizonte y anota hasta dónde llegó. */
async function materializeSchedule(
  client: TenantTransactionClient,
  schedule: StoredSchedule,
  input: { today: string; calendar: CenterCalendar },
): Promise<SkippedOccurrence[]> {
  await lockSchedule(client, schedule.id);
  const window = resolvePendingWindow({
    today: input.today,
    materializedUntil:
      schedule.materializedUntil === null ? null : toDateOnly(schedule.materializedUntil),
  });
  if (window === null) return [];
  const dates = listOccurrenceDates(
    {
      weekday: schedule.weekday as ScheduleWeekday,
      startsOn: toDateOnly(schedule.startsOn),
      endsOn: schedule.endsOn === null ? null : toDateOnly(schedule.endsOn),
    },
    window,
  );
  const context: MaterializationContext = {
    calendar: input.calendar,
    window,
    absences: await listAbsences(client, { staffMembershipId: schedule.staffMembershipId, window }),
  };
  const skipped: SkippedOccurrence[] = [];
  for (const date of dates) {
    const skippedDate = await materializeDate(client, schedule, { date, context });
    if (skippedDate) skipped.push(skippedDate);
  }
  await client.sessionSchedule.update({
    where: { id: schedule.id },
    data: { materializedUntil: toDateColumn(window.toDate) },
  });
  return skipped;
}

/**
 * Crea las sesiones que falten de los horarios activos (todos, o los indicados) hasta 8 semanas por
 * delante. Se llama al crear o cambiar un horario y al leer la agenda: así las sesiones existen
 * siempre sin necesitar un proceso aparte, y relanzarlo nunca duplica nada.
 */
export async function materializeSchedulesInTransaction(
  client: TenantTransactionClient,
  input: { today: string; scheduleIds?: readonly string[] | undefined },
): Promise<SkippedOccurrence[]> {
  const horizonEnd = addDaysToLocalDate(input.today, MATERIALIZATION_HORIZON_DAYS);
  const schedules = await client.sessionSchedule.findMany({
    where: {
      status: 'active',
      ...(input.scheduleIds && { id: { in: [...input.scheduleIds] } }),
      OR: [{ materializedUntil: null }, { materializedUntil: { lt: toDateColumn(horizonEnd) } }],
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  if (schedules.length === 0) return [];
  const calendar = await loadCenterCalendar(client);
  const skipped: SkippedOccurrence[] = [];
  for (const schedule of schedules) {
    skipped.push(
      ...(await materializeSchedule(client, schedule, { today: input.today, calendar })),
    );
  }
  return skipped;
}
