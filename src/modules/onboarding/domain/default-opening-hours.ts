import { type OpeningHours } from '../../centers/domain/opening-hours';

const MORNING_SHIFT = { opensAt: '09:00', closesAt: '14:00' } as const;
const AFTERNOON_SHIFT = { opensAt: '16:00', closesAt: '20:00' } as const;
const WEEKDAY_SHIFTS = [MORNING_SHIFT, AFTERNOON_SHIFT];

/**
 * Horario con el que arranca un centro nuevo: de lunes a viernes, mañana y tarde. Fin de semana
 * cerrado (día sin tramos). El centro lo ajusta después en sus ajustes.
 */
export const DEFAULT_OPENING_HOURS: OpeningHours = {
  mon: WEEKDAY_SHIFTS,
  tue: WEEKDAY_SHIFTS,
  wed: WEEKDAY_SHIFTS,
  thu: WEEKDAY_SHIFTS,
  fri: WEEKDAY_SHIFTS,
  sat: [],
  sun: [],
};
