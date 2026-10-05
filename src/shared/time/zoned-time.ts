import {
  MILLISECONDS_PER_DAY,
  MILLISECONDS_PER_MINUTE,
  MILLISECONDS_PER_SECOND,
} from './time-units';

/** Los días de la semana con el nombre que usa `centers.opening_hours`, empezando en lunes. */
export const WEEKDAYS_FROM_MONDAY = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type WeekdayName = (typeof WEEKDAYS_FROM_MONDAY)[number];

const SUNDAY_TO_MONDAY_INDEX_SHIFT = 6;
const DAYS_PER_WEEK = 7;
const ISO_DATE_LENGTH = 'YYYY-MM-DD'.length;
const YEAR_DIGITS = 4;
const MONTH_OR_DAY_DIGITS = 2;

const formatterByTimeZone = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timeZone: string): Intl.DateTimeFormat {
  const cachedFormatter = formatterByTimeZone.get(timeZone);
  if (cachedFormatter) return cachedFormatter;
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  formatterByTimeZone.set(timeZone, formatter);
  return formatter;
}

interface LocalDateTimeParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

function readLocalParts(instant: Date, timeZone: string): LocalDateTimeParts {
  const parts = Object.fromEntries(
    getFormatter(timeZone)
      .formatToParts(instant)
      .map((part) => [part.type, Number(part.value)]),
  ) as Record<string, number>;
  return {
    year: parts['year'] ?? 0,
    month: parts['month'] ?? 0,
    day: parts['day'] ?? 0,
    hour: parts['hour'] ?? 0,
    minute: parts['minute'] ?? 0,
    second: parts['second'] ?? 0,
  };
}

/** Diferencia entre la hora local de la zona y UTC en ese instante (cambia con el horario de verano). */
function getUtcOffsetMilliseconds(instant: Date, timeZone: string): number {
  const local = readLocalParts(instant, timeZone);
  const localAsIfUtc = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second,
  );
  const wholeSecondsInstant = Math.floor(instant.getTime() / MILLISECONDS_PER_SECOND);
  return localAsIfUtc - wholeSecondsInstant * MILLISECONDS_PER_SECOND;
}

function parseDateParts(localDate: string): { year: number; month: number; day: number } {
  const [year = 0, month = 1, day = 1] = localDate.split('-').map(Number);
  return { year, month, day };
}

function toUtcMidnight(localDate: string): number {
  const { year, month, day } = parseDateParts(localDate);
  return Date.UTC(year, month - 1, day);
}

/**
 * Instante UTC de una fecha y hora locales ("2026-10-25" y "09:00") en una zona. Una hora que no
 * existe (el salto de las 02:00 a las 03:00 en marzo) se desplaza hacia delante; una que ocurre dos
 * veces (octubre) resuelve a la segunda (hora de invierno).
 */
export function zonedDateTimeToUtc(localDate: string, localTime: string, timeZone: string): Date {
  const { year, month, day } = parseDateParts(localDate);
  const [hours = 0, minutes = 0] = localTime.split(':').map(Number);
  const localAsIfUtc = Date.UTC(year, month - 1, day, hours, minutes);

  const guessedOffset = getUtcOffsetMilliseconds(new Date(localAsIfUtc), timeZone);
  const candidate = localAsIfUtc - guessedOffset;
  const candidateOffset = getUtcOffsetMilliseconds(new Date(candidate), timeZone);
  return new Date(candidateOffset === guessedOffset ? candidate : localAsIfUtc - candidateOffset);
}

/** Fecha local (`YYYY-MM-DD`) en la que cae un instante, en la zona del centro. */
export function toLocalDate(instant: Date, timeZone: string): string {
  const { year, month, day } = readLocalParts(instant, timeZone);
  return `${String(year).padStart(YEAR_DIGITS, '0')}-${String(month).padStart(MONTH_OR_DAY_DIGITS, '0')}-${String(day).padStart(MONTH_OR_DAY_DIGITS, '0')}`;
}

export function addDaysToLocalDate(localDate: string, dayCount: number): string {
  const shifted = new Date(toUtcMidnight(localDate) + dayCount * MILLISECONDS_PER_DAY);
  return shifted.toISOString().slice(0, ISO_DATE_LENGTH);
}

export function daysBetweenLocalDates(fromDate: string, toDate: string): number {
  return Math.round((toUtcMidnight(toDate) - toUtcMidnight(fromDate)) / MILLISECONDS_PER_DAY);
}

export function getWeekdayOfLocalDate(localDate: string): WeekdayName {
  const dayIndexFromSunday = new Date(toUtcMidnight(localDate)).getUTCDay();
  const dayIndexFromMonday = (dayIndexFromSunday + SUNDAY_TO_MONDAY_INDEX_SHIFT) % DAYS_PER_WEEK;
  return WEEKDAYS_FROM_MONDAY[dayIndexFromMonday] ?? 'mon';
}

/** Todas las fechas entre dos fechas locales, ambas incluidas. */
export function listLocalDates(fromDate: string, toDate: string): string[] {
  const dateCount = Math.max(daysBetweenLocalDates(fromDate, toDate) + 1, 0);
  return Array.from({ length: dateCount }, (_unused, offset) =>
    addDaysToLocalDate(fromDate, offset),
  );
}

export interface UtcRange {
  readonly startsAt: Date;
  readonly endsAt: Date;
}

/** Desde las 00:00 locales de la primera fecha hasta las 00:00 locales del día siguiente a la última. */
export function getUtcRangeOfLocalDates(
  fromDate: string,
  toDate: string,
  timeZone: string,
): UtcRange {
  return {
    startsAt: zonedDateTimeToUtc(fromDate, '00:00', timeZone),
    endsAt: zonedDateTimeToUtc(addDaysToLocalDate(toDate, 1), '00:00', timeZone),
  };
}

export function addMinutes(instant: Date, minutes: number): Date {
  return new Date(instant.getTime() + minutes * MILLISECONDS_PER_MINUTE);
}
