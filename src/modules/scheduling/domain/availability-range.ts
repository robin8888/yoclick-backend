import { daysBetweenLocalDates } from '../../../shared/time/zoned-time';

/** Tope de la consulta de huecos (SEC-50, rangos de fechas acotados): dos semanas, ambos días incluidos. */
export const MAX_AVAILABILITY_RANGE_DAYS = 14;

export function isAvailabilityRangeAllowed(fromDate: string, toDate: string): boolean {
  const spanDays = daysBetweenLocalDates(fromDate, toDate);
  return spanDays >= 0 && spanDays <= MAX_AVAILABILITY_RANGE_DAYS;
}
