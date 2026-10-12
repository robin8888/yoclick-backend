import {
  addDaysToLocalDate,
  getWeekdayOfLocalDate,
  listLocalDates,
  WEEKDAYS_FROM_MONDAY,
} from '../../../shared/time/zoned-time';
import { toMinutesSinceMidnight } from '../../centers/domain/opening-hours';

/** Hasta cuántos días por delante existen ya las sesiones de un horario (8 semanas rodando). */
export const MATERIALIZATION_HORIZON_DAYS = 56;
/** Un horario cubre como mucho una sesión por día de la semana. */
export const MAX_DAYS_PER_SERIES = 7;
export const MAX_SCHEDULE_LABEL_LENGTH = 80;
export const MIN_SCHEDULE_CAPACITY = 1;
export const MAX_SCHEDULE_CAPACITY = 500;
/** Una serie no dura más de un curso largo; más allá es un error de uso. */
export const MAX_SERIES_LENGTH_DAYS = 400;
export const MAX_ENROLLMENTS_PER_REQUEST = 100;
export const MAX_BLOCK_NOTE_LENGTH = 200;
export const MAX_CANCEL_REASON_LENGTH = 200;
/** Un bloqueo no se extiende más de este número de días (un alquiler largo son varios bloqueos). */
export const MAX_BLOCK_LENGTH_DAYS = 31;
/** Hasta cuántos horarios activos puede tener un centro. */
export const MAX_ACTIVE_SCHEDULES_PER_CENTER = 500;

const MONDAY = 1;
const TUESDAY = 2;
const WEDNESDAY = 3;
const THURSDAY = 4;
const FRIDAY = 5;
const SATURDAY = 6;
const SUNDAY = 7;

/** 1 = lunes … 7 = domingo, como `isoWeekday`. */
export type ScheduleWeekday =
  | typeof MONDAY
  | typeof TUESDAY
  | typeof WEDNESDAY
  | typeof THURSDAY
  | typeof FRIDAY
  | typeof SATURDAY
  | typeof SUNDAY;
export const SCHEDULE_WEEKDAYS: readonly ScheduleWeekday[] = [
  MONDAY,
  TUESDAY,
  WEDNESDAY,
  THURSDAY,
  FRIDAY,
  SATURDAY,
  SUNDAY,
];

export type ServiceModeName = 'private' | 'group' | 'both';
export type SessionModeName = 'private' | 'group';

export function getScheduleWeekdayOfLocalDate(localDate: string): ScheduleWeekday {
  const weekdayIndex = WEEKDAYS_FROM_MONDAY.indexOf(getWeekdayOfLocalDate(localDate));
  return SCHEDULE_WEEKDAYS[weekdayIndex] ?? MONDAY;
}

export interface OccurrenceRule {
  readonly weekday: ScheduleWeekday;
  /** Fechas locales `YYYY-MM-DD`, ambas incluidas; `endsOn` nulo = sin fin. */
  readonly startsOn: string;
  readonly endsOn: string | null;
}

export interface DateWindow {
  readonly fromDate: string;
  readonly toDate: string;
}

function latestOf(first: string, second: string): string {
  return first > second ? first : second;
}

function earliestOf(first: string, second: string | null): string {
  return second !== null && second < first ? second : first;
}

/** Las fechas en que ocurre un horario dentro de una ventana: su día de la semana, acotado por su periodo. */
export function listOccurrenceDates(rule: OccurrenceRule, window: DateWindow): string[] {
  const fromDate = latestOf(rule.startsOn, window.fromDate);
  const toDate = earliestOf(window.toDate, rule.endsOn);
  if (fromDate > toDate) return [];
  return listLocalDates(fromDate, toDate).filter(
    (date) => getScheduleWeekdayOfLocalDate(date) === rule.weekday,
  );
}

/** El tramo de fechas que todavía no tiene sesiones: desde el día siguiente al último creado. */
export function resolvePendingWindow(input: {
  readonly today: string;
  readonly materializedUntil: string | null;
}): DateWindow | null {
  const horizonEnd = addDaysToLocalDate(input.today, MATERIALIZATION_HORIZON_DAYS);
  const fromDate =
    input.materializedUntil === null
      ? input.today
      : latestOf(input.today, addDaysToLocalDate(input.materializedUntil, 1));
  return fromDate > horizonEnd ? null : { fromDate, toDate: horizonEnd };
}

export interface AbsencePeriod {
  readonly startsOn: string;
  readonly endsOn: string;
}

export type SkipReason = 'holiday' | 'absence';

/** Por qué un horario no ocurre ese día: el centro cierra o la persona que lo da no está. */
export function findSkipReason(input: {
  readonly date: string;
  readonly holidayDates: readonly string[];
  readonly absences: readonly AbsencePeriod[];
}): SkipReason | null {
  if (input.holidayDates.includes(input.date)) return 'holiday';
  const isAbsent = input.absences.some(
    ({ startsOn, endsOn }) => startsOn <= input.date && input.date <= endsOn,
  );
  return isAbsent ? 'absence' : null;
}

/** Una sesión privada admite a una persona; una grupal, tantas como quepan en la sala (o las que pida el centro, si son menos). */
export function resolveSessionCapacity(input: {
  readonly mode: SessionModeName;
  readonly roomCapacity: number | null;
  readonly requestedCapacity: number | null;
}): number {
  if (input.mode === 'private') return 1;
  const roomCapacity = input.roomCapacity ?? MAX_SCHEDULE_CAPACITY;
  const requested = input.requestedCapacity ?? roomCapacity;
  return Math.max(MIN_SCHEDULE_CAPACITY, Math.min(requested, roomCapacity));
}

/** Un servicio «solo privado» no admite grupos y viceversa; «ambas» admite los dos. */
export function isModeAllowedByService(
  serviceMode: ServiceModeName,
  sessionMode: SessionModeName,
): boolean {
  return serviceMode === 'both' || serviceMode === sessionMode;
}

export function isTimeRangeOrdered(startsAtTime: string, endsAtTime: string): boolean {
  return toMinutesSinceMidnight(startsAtTime) < toMinutesSinceMidnight(endsAtTime);
}
