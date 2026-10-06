import { getWeekdayOfLocalDate } from '../../../shared/time/zoned-time';
export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export interface OpeningInterval {
  readonly opensAt: string;
  readonly closesAt: string;
}

export type OpeningHours = Partial<Record<Weekday, readonly OpeningInterval[] | undefined>>;

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const MINUTES_PER_HOUR = 60;

export function isValidTimeOfDay(time: string): boolean {
  return TIME_PATTERN.test(time);
}

export function toMinutesSinceMidnight(time: string): number {
  const [hours = '0', minutes = '0'] = time.split(':');
  return Number(hours) * MINUTES_PER_HOUR + Number(minutes);
}

/**
 * Los tramos de un día deben abrir antes de cerrar y no solaparse. Un día sin tramos (o sin entrada)
 * significa cerrado.
 */
export function areIntervalsConsistent(intervals: readonly OpeningInterval[]): boolean {
  const sorted = intervals
    .map(({ opensAt, closesAt }) => ({
      start: toMinutesSinceMidnight(opensAt),
      end: toMinutesSinceMidnight(closesAt),
    }))
    .sort((first, second) => first.start - second.start);

  return sorted.every(
    (interval, index) =>
      interval.start < interval.end && interval.start >= (sorted[index - 1]?.end ?? 0),
  );
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('es-ES', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Los tramos en los que el centro abre en una fecha local; vacío si es festivo o ese día no abre. */
export function listOpeningRangesOfDate(
  openingHours: OpeningHours | null,
  holidayDates: readonly string[],
  date: string,
): readonly OpeningInterval[] {
  if (holidayDates.includes(date)) return [];
  return openingHours?.[getWeekdayOfLocalDate(date)] ?? [];
}
