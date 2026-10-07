import { z } from 'zod';
import { areIntervalsConsistent, isValidTimeOfDay, WEEKDAYS } from '../domain/opening-hours';

const MAX_INTERVALS_PER_DAY = 4;

const timeOfDaySchema = z.string().refine(isValidTimeOfDay, 'expected HH:MM');

const dayIntervalsSchema = z
  .array(z.strictObject({ opensAt: timeOfDaySchema, closesAt: timeOfDaySchema }))
  .max(MAX_INTERVALS_PER_DAY)
  .refine(areIntervalsConsistent, 'intervals must open before they close and not overlap');

/** Horario semanal: hasta cuatro tramos por día; un día sin tramos (o sin entrada) es un día cerrado. */
export const openingHoursSchema = z.strictObject(
  Object.fromEntries(WEEKDAYS.map((weekday) => [weekday, dayIntervalsSchema.optional()])) as Record<
    (typeof WEEKDAYS)[number],
    z.ZodOptional<typeof dayIntervalsSchema>
  >,
);

/** Como `openingHoursSchema`, pero con los siete días siempre presentes (vacío = no trabaja ese día). */
export const fullWeekHoursSchema = z.strictObject(
  Object.fromEntries(WEEKDAYS.map((weekday) => [weekday, dayIntervalsSchema])) as Record<
    (typeof WEEKDAYS)[number],
    typeof dayIntervalsSchema
  >,
);
