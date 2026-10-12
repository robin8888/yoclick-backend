import { v7 as generateUuidV7 } from 'uuid';
import { type TenantTransactionClient } from '../../../shared/database/tenant-prisma.service';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { toLocalDate } from '../../../shared/time/zoned-time';
import { hasOverlappingBooking } from '../../bookings/infrastructure/client-overlap';
import {
  type EnrollmentView,
  type EnrollOutcome,
  type NewEnrollments,
  type SkippedEnrollment,
  type SkippedEnrollmentDate,
  type UnenrollOutcome,
} from '../application/ports/schedule.repository';
import { toDateColumn, toDateOnly } from './schedule-materialization';
import { recordEnrollmentNotices } from './schedule-notices';
import { ENROLLMENT_VIEW_INCLUDE, findSeriesView, toEnrollmentView } from './schedule-view.mapper';

/** Serializa las matrículas de una serie: dos peticiones a la vez no se pasan del aforo. */
async function lockSeriesEnrollments(
  client: TenantTransactionClient,
  seriesId: string,
): Promise<void> {
  await client.$executeRaw`select pg_advisory_xact_lock(hashtextextended(${seriesId}, 4))`;
}

async function isActiveClient(
  client: TenantTransactionClient,
  membershipId: string,
): Promise<boolean> {
  const count = await client.membership.count({
    where: { id: membershipId, role: 'client', status: 'active' },
  });
  return count === 1;
}

interface SeriesFacts {
  readonly scheduleIds: readonly string[];
  readonly capacity: number;
  readonly startsOn: string;
  readonly endsOn: string | null;
}

async function findActiveSeriesFacts(
  client: TenantTransactionClient,
  seriesId: string,
): Promise<SeriesFacts | null> {
  const rows = await client.sessionSchedule.findMany({
    where: { seriesId, status: 'active' },
    select: { id: true, capacity: true, startsOn: true, endsOn: true },
  });
  const [first] = rows;
  if (!first) return null;
  return {
    scheduleIds: rows.map(({ id }) => id),
    capacity: Math.min(...rows.map(({ capacity }) => capacity)),
    startsOn: toDateOnly(first.startsOn),
    endsOn: first.endsOn === null ? null : toDateOnly(first.endsOn),
  };
}

async function findEnrollmentRefusal(
  client: TenantTransactionClient,
  input: { seriesId: string; clientMembershipId: string; capacity: number },
): Promise<SkippedEnrollment['reason'] | null> {
  if (!(await isActiveClient(client, input.clientMembershipId))) return 'client_not_found';
  const existing = await client.scheduleEnrollment.count({
    where: {
      seriesId: input.seriesId,
      clientMembershipId: input.clientMembershipId,
      status: 'active',
    },
  });
  if (existing > 0) return 'already_enrolled';
  const enrolledCount = await client.scheduleEnrollment.count({
    where: { seriesId: input.seriesId, status: 'active' },
  });
  return enrolledCount >= input.capacity ? 'series_full' : null;
}

interface EnrollmentPeriod {
  readonly startsOn: string;
  readonly endsOn: string | null;
}

interface FutureSession {
  readonly id: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

/** Las sesiones futuras de la serie dentro del periodo de la matrícula (fecha local del centro). */
async function listFutureSessionsInPeriod(
  client: TenantTransactionClient,
  input: { scheduleIds: readonly string[]; period: EnrollmentPeriod; now: Date; timeZone: string },
): Promise<FutureSession[]> {
  const sessions = await client.classSession.findMany({
    where: {
      scheduleId: { in: [...input.scheduleIds] },
      status: 'scheduled',
      startsAt: { gt: input.now },
    },
    select: { id: true, startsAt: true, endsAt: true },
    orderBy: [{ startsAt: 'asc' }],
  });
  const { startsOn, endsOn } = input.period;
  return sessions.filter((session) => {
    const date = toLocalDate(session.startsAt, input.timeZone);
    return date >= startsOn && (endsOn === null || date <= endsOn);
  });
}

interface EnrollmentBookingInput {
  readonly actor: ActorContext;
  readonly enrollmentId: string;
  readonly clientMembershipId: string;
  readonly session: FutureSession;
}

async function createEnrollmentBooking(
  client: TenantTransactionClient,
  input: EnrollmentBookingInput,
): Promise<void> {
  await client.booking.create({
    data: {
      id: generateUuidV7(),
      centerId: input.actor.centerId,
      classSessionId: input.session.id,
      clientMembershipId: input.clientMembershipId,
      status: 'confirmed',
      source: 'enrollment',
      enrollmentId: input.enrollmentId,
      createdByMembershipId: input.actor.membershipId,
      createdByRole: input.actor.role,
    },
  });
}

/** La plaza de la persona en cada sesión futura ya creada de la serie; si ese día ya tiene otra cita, se salta. */
async function bookExistingSessions(
  client: TenantTransactionClient,
  input: Omit<EnrollmentBookingInput, 'session'> & {
    scheduleIds: readonly string[];
    period: EnrollmentPeriod;
    now: Date;
    timeZone: string;
  },
): Promise<SkippedEnrollmentDate[]> {
  const sessions = await listFutureSessionsInPeriod(client, input);
  const skippedDates: SkippedEnrollmentDate[] = [];
  for (const session of sessions) {
    const isBusy = await hasOverlappingBooking(client, {
      clientMembershipId: input.clientMembershipId,
      startsAt: session.startsAt,
      endsAt: session.endsAt,
    });
    if (isBusy) {
      skippedDates.push({
        clientMembershipId: input.clientMembershipId,
        date: toLocalDate(session.startsAt, input.timeZone),
      });
      continue;
    }
    await createEnrollmentBooking(client, { ...input, session });
  }
  return skippedDates;
}

interface EnrollOneInput {
  readonly actor: ActorContext;
  readonly request: NewEnrollments & { now: Date };
  readonly series: SeriesFacts;
  readonly clientMembershipId: string;
  readonly timeZone: string;
}

async function enrollOne(
  client: TenantTransactionClient,
  input: EnrollOneInput,
): Promise<{ enrollment: EnrollmentView; skippedDates: SkippedEnrollmentDate[] }> {
  const { actor, request, series, clientMembershipId } = input;
  const period: EnrollmentPeriod = {
    startsOn: request.startsOn ?? series.startsOn,
    endsOn: request.endsOn ?? series.endsOn,
  };
  const created = await client.scheduleEnrollment.create({
    data: {
      id: generateUuidV7(),
      centerId: actor.centerId,
      seriesId: request.seriesId,
      clientMembershipId,
      startsOn: toDateColumn(period.startsOn),
      endsOn: period.endsOn === null ? null : toDateColumn(period.endsOn),
      createdByMembershipId: actor.membershipId,
    },
    include: ENROLLMENT_VIEW_INCLUDE,
  });
  const skippedDates = await bookExistingSessions(client, {
    actor,
    enrollmentId: created.id,
    clientMembershipId,
    scheduleIds: series.scheduleIds,
    period,
    now: request.now,
    timeZone: input.timeZone,
  });
  return { enrollment: toEnrollmentView(created), skippedDates };
}

type EnrolledOutcome = Extract<EnrollOutcome, { kind: 'enrolled' }>;

/** Matricula a cada persona por turno: las que no caben o ya estaban quedan en `skipped`. */
async function enrollEach(
  client: TenantTransactionClient,
  input: Omit<EnrollOneInput, 'clientMembershipId'>,
): Promise<EnrolledOutcome> {
  const enrollments: EnrollmentView[] = [];
  const skipped: SkippedEnrollment[] = [];
  const skippedDates: SkippedEnrollmentDate[] = [];
  for (const clientMembershipId of new Set(input.request.clientMembershipIds)) {
    const reason = await findEnrollmentRefusal(client, {
      seriesId: input.request.seriesId,
      clientMembershipId,
      capacity: input.series.capacity,
    });
    if (reason !== null) {
      skipped.push({ clientMembershipId, reason });
      continue;
    }
    const outcome = await enrollOne(client, { ...input, clientMembershipId });
    enrollments.push(outcome.enrollment);
    skippedDates.push(...outcome.skippedDates);
  }
  return { kind: 'enrolled', enrollments, skipped, skippedDates };
}

export async function enrollInTransaction(
  client: TenantTransactionClient,
  actor: ActorContext,
  request: NewEnrollments & { now: Date },
): Promise<EnrollOutcome> {
  await lockSeriesEnrollments(client, request.seriesId);
  const series = await findActiveSeriesFacts(client, request.seriesId);
  if (!series) return { kind: 'series_not_found' };
  const center = await client.center.findFirstOrThrow({ select: { timezone: true } });

  const outcome = await enrollEach(client, { actor, request, series, timeZone: center.timezone });
  if (outcome.enrollments.length > 0) {
    await recordEnrollmentNotices(client, actor, {
      kind: 'schedule_enrolled',
      clientMembershipIds: outcome.enrollments.map(({ client: person }) => person.membershipId),
      series: await findSeriesView(client, request.seriesId),
    });
  }
  return outcome;
}

export async function unenrollInTransaction(
  client: TenantTransactionClient,
  actor: ActorContext,
  request: { seriesId: string; enrollmentId: string; now: Date },
): Promise<UnenrollOutcome> {
  const enrollment = await client.scheduleEnrollment.findFirst({
    where: { id: request.enrollmentId, seriesId: request.seriesId, status: 'active' },
    select: { id: true, clientMembershipId: true },
  });
  if (!enrollment) return { kind: 'not_found' };
  await client.scheduleEnrollment.update({
    where: { id: enrollment.id },
    data: { status: 'ended', endedAt: request.now },
  });
  const cancelled = await client.booking.updateMany({
    where: {
      enrollmentId: enrollment.id,
      status: 'confirmed',
      classSession: { startsAt: { gt: request.now } },
    },
    data: {
      status: 'cancelled',
      cancelledAt: request.now,
      cancelledBy: 'staff',
      cancelWithinPolicy: true,
    },
  });
  await recordEnrollmentNotices(client, actor, {
    kind: 'schedule_unenrolled',
    clientMembershipIds: [enrollment.clientMembershipId],
    series: await findSeriesView(client, request.seriesId),
  });
  return { kind: 'unenrolled', cancelledBookingCount: cancelled.count };
}
