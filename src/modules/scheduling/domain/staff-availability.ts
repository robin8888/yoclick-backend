import { type OpeningHours } from '../../centers/domain/opening-hours';
import {
  getWeekdayOfLocalDate,
  toLocalDate,
  zonedDateTimeToUtc,
} from '../../../shared/time/zoned-time';

/** Días seguidos en los que alguien no atiende; ambos extremos incluidos (`YYYY-MM-DD`). */
export interface AbsenceSpan {
  readonly startsOn: string;
  readonly endsOn: string;
}

export interface StaffAvailabilityRules {
  /** Horario semanal propio; `null` o ausente significa que sigue el del centro. */
  readonly weeklyHours?: OpeningHours | null | undefined;
  readonly absences?: readonly AbsenceSpan[] | undefined;
}

export function isAbsentOnDate(absences: readonly AbsenceSpan[], date: string): boolean {
  return absences.some(({ startsOn, endsOn }) => date >= startsOn && date <= endsOn);
}

/**
 * ¿Atiende esa persona en ese hueco? No si está de ausencia ese día, ni si tiene horario propio y el
 * hueco no cabe entero en uno de sus tramos. El horario del centro se aplica antes, al crear la rejilla.
 */
export function isStaffAvailableForSlot(
  rules: StaffAvailabilityRules,
  slot: { readonly startsAt: Date; readonly endsAt: Date },
  timeZone: string,
): boolean {
  const date = toLocalDate(slot.startsAt, timeZone);
  if (isAbsentOnDate(rules.absences ?? [], date)) return false;
  if (!rules.weeklyHours) return true;

  const intervals = rules.weeklyHours[getWeekdayOfLocalDate(date)] ?? [];
  return intervals.some(
    ({ opensAt, closesAt }) =>
      slot.startsAt >= zonedDateTimeToUtc(date, opensAt, timeZone) &&
      slot.endsAt <= zonedDateTimeToUtc(date, closesAt, timeZone),
  );
}
