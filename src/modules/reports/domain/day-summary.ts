import { type OpeningHours, toMinutesSinceMidnight } from '../../centers/domain/opening-hours';
import {
  addDaysToLocalDate,
  getWeekdayOfLocalDate,
  WEEKDAYS_FROM_MONDAY,
} from '../../../shared/time/zoned-time';

const DAYS_AFTER_MONDAY_IN_WEEK = 6;
const PERCENT = 100;

export interface LocalDateRange {
  readonly fromDate: string;
  readonly toDate: string;
}

/** Minutos que el centro está abierto ese día; 0 si es festivo o no abre. */
export function sumOpenMinutes(
  openingHours: OpeningHours | null,
  holidayDates: readonly string[],
  date: string,
): number {
  if (holidayDates.includes(date)) return 0;
  const intervals = openingHours?.[getWeekdayOfLocalDate(date)] ?? [];
  return intervals.reduce(
    (total, { opensAt, closesAt }) =>
      total + toMinutesSinceMidnight(closesAt) - toMinutesSinceMidnight(opensAt),
    0,
  );
}

/**
 * Qué parte del tiempo disponible del equipo está reservada, de 0 a 100. `null` si no hay tiempo
 * disponible (centro cerrado o sin nadie que atienda): un porcentaje de nada no significa nada.
 */
export function calculateOccupancyPercent(input: {
  readonly bookedMinutes: number;
  readonly openMinutes: number;
  readonly staffCount: number;
}): number | null {
  const availableMinutes = input.openMinutes * input.staffCount;
  if (availableMinutes <= 0) return null;
  return Math.min(PERCENT, Math.round((input.bookedMinutes / availableMinutes) * PERCENT));
}

/** La semana (de lunes a domingo) a la que pertenece una fecha local. */
export function getWeekOfLocalDate(date: string): LocalDateRange {
  const daysSinceMonday = WEEKDAYS_FROM_MONDAY.indexOf(getWeekdayOfLocalDate(date));
  const fromDate = addDaysToLocalDate(date, -daysSinceMonday);
  return { fromDate, toDate: addDaysToLocalDate(fromDate, DAYS_AFTER_MONDAY_IN_WEEK) };
}
