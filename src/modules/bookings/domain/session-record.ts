import { MILLISECONDS_PER_MINUTE, MILLISECONDS_PER_SECOND } from '../../../shared/time/time-units';
import { daysBetweenLocalDates } from '../../../shared/time/zoned-time';
import { type BookingStatusName } from './cancellation-policy';

/** Se puede abrir la clase un poco antes de su hora: quien atiende suele estar ya con la persona. */
export const SESSION_START_LEEWAY_MINUTES = 15;

export const MAX_SESSION_NOTES_LENGTH = 500;

/** El informe de una persona del equipo no abarca más de un mes natural largo. */
export const MAX_SESSION_RECORDS_RANGE_DAYS = 31;

export interface SessionStartFacts {
  readonly status: BookingStatusName;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly startedAt: Date | null;
  readonly now: Date;
}

export type SessionStartVerdict = 'can_start' | 'already_started' | 'not_startable';

/**
 * Solo una reserva confirmada puede iniciarse, desde 15 minutos antes de su hora hasta que termina.
 * Una ya iniciada se trata como éxito (repetir la petición no falla ni cambia la hora de inicio).
 */
export function decideSessionStart(facts: SessionStartFacts): SessionStartVerdict {
  if (facts.startedAt !== null) return 'already_started';
  if (facts.status !== 'confirmed') return 'not_startable';
  const opensAt = facts.startsAt.getTime() - SESSION_START_LEEWAY_MINUTES * MILLISECONDS_PER_MINUTE;
  const isInsideWindow = facts.now.getTime() >= opensAt && facts.now <= facts.endsAt;
  return isInsideWindow ? 'can_start' : 'not_startable';
}

export type SessionEndVerdict = 'can_end' | 'already_ended' | 'not_started';

/** Se puede cerrar más tarde sin límite; cerrar una ya cerrada devuelve lo mismo que la primera vez. */
export function decideSessionEnd(facts: {
  readonly startedAt: Date | null;
  readonly endedAt: Date | null;
}): SessionEndVerdict {
  if (facts.endedAt !== null) return 'already_ended';
  return facts.startedAt === null ? 'not_started' : 'can_end';
}

/** Segundos enteros entre inicio y fin; `null` mientras la clase no ha terminado. */
export function calculateActualDurationSeconds(timing: {
  readonly startedAt: Date | null;
  readonly endedAt: Date | null;
}): number | null {
  if (timing.startedAt === null || timing.endedAt === null) return null;
  const elapsedMilliseconds = timing.endedAt.getTime() - timing.startedAt.getTime();
  return Math.floor(elapsedMilliseconds / MILLISECONDS_PER_SECOND);
}

export function calculatePlannedDurationSeconds(plannedTiming: {
  readonly startsAt: Date;
  readonly endsAt: Date;
}): number {
  return Math.round(
    (plannedTiming.endsAt.getTime() - plannedTiming.startsAt.getTime()) / MILLISECONDS_PER_SECOND,
  );
}

export function isSessionOpen(timing: {
  readonly startedAt: Date | null;
  readonly endedAt: Date | null;
}): boolean {
  return timing.startedAt !== null && timing.endedAt === null;
}

export interface SessionRecordForTotals {
  readonly staff: { readonly membershipId: string; readonly fullName: string };
  readonly plannedDurationSeconds: number;
  readonly actualDurationSeconds: number | null;
  readonly isOpen: boolean;
}

export interface StaffSessionTotals {
  readonly staffMembershipId: string;
  readonly staffName: string;
  /** Clases cerradas. */
  readonly classCount: number;
  /** Duración prevista de esas clases cerradas, para compararla con `actualSeconds`. */
  readonly plannedSeconds: number;
  readonly actualSeconds: number;
  /** Clases iniciadas y todavía sin terminar. */
  readonly openCount: number;
}

/** Totales por persona del equipo: solo cuentan las clases cerradas (y se cuentan aparte las abiertas). */
export function summarizeSessionRecordsByStaff(
  records: readonly SessionRecordForTotals[],
): StaffSessionTotals[] {
  const totalsByStaff = new Map<string, StaffSessionTotals>();
  for (const record of records) {
    const current = totalsByStaff.get(record.staff.membershipId) ?? {
      staffMembershipId: record.staff.membershipId,
      staffName: record.staff.fullName,
      classCount: 0,
      plannedSeconds: 0,
      actualSeconds: 0,
      openCount: 0,
    };
    const isClosed = record.actualDurationSeconds !== null;
    totalsByStaff.set(record.staff.membershipId, {
      ...current,
      classCount: current.classCount + (isClosed ? 1 : 0),
      plannedSeconds: current.plannedSeconds + (isClosed ? record.plannedDurationSeconds : 0),
      actualSeconds: current.actualSeconds + (record.actualDurationSeconds ?? 0),
      openCount: current.openCount + (record.isOpen ? 1 : 0),
    });
  }
  return [...totalsByStaff.values()].sort(
    (first, second) =>
      first.staffName.localeCompare(second.staffName) ||
      first.staffMembershipId.localeCompare(second.staffMembershipId),
  );
}

/** Ambos días incluidos: del 1 al 31 son 31 días. */
export function isSessionRecordsRangeAllowed(fromDate: string, toDate: string): boolean {
  const spanDays = daysBetweenLocalDates(fromDate, toDate);
  return spanDays >= 0 && spanDays < MAX_SESSION_RECORDS_RANGE_DAYS;
}
