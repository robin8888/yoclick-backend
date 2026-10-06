import { z } from 'zod';
import { createZodDto } from '../../../shared/http/create-zod-dto';
import { isAvailabilityRangeAllowed } from '../domain/availability-range';

export class CenterRouteParamsDto extends createZodDto(z.strictObject({ centerId: z.uuid() })) {}

const MINUTES_PER_HOUR = 60;
const HALF_HOUR_MINUTES = 30;
const QUARTER_HOUR_MINUTES = 15;
const TEN_MINUTES = 10;
const FIVE_MINUTES = 5;
const ALLOWED_STEP_MINUTES: readonly number[] = [
  FIVE_MINUTES,
  TEN_MINUTES,
  QUARTER_HOUR_MINUTES,
  HALF_HOUR_MINUTES,
  MINUTES_PER_HOUR,
];

export class AvailabilityQueryDto extends createZodDto(
  z
    .strictObject({
      serviceId: z.uuid(),
      from: z.iso.date(),
      to: z.iso.date(),
      staffMembershipId: z.uuid().optional(),
      /** Solo para el equipo: horas de inicio cada 5, 10, 15, 30 o 60 minutos. */
      stepMinutes: z.coerce
        .number()
        .int()
        .refine((minutes) => ALLOWED_STEP_MINUTES.includes(minutes), {
          error: 'stepMinutes must be 5, 10, 15, 30 or 60',
        })
        .optional(),
    })
    .refine((query) => isAvailabilityRangeAllowed(query.from, query.to), {
      path: ['to'],
      error: 'to must not be before from, nor more than 14 days after it',
    }),
) {}

const availableSlotShape = {
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  staffMembershipId: z.uuid(),
  staffName: z.string(),
};

export class AvailabilityResponseDto extends createZodDto(
  z.strictObject({
    /** Zona horaria del centro: los días y los huecos se calculan en ella. */
    timezone: z.string(),
    days: z.array(
      z.strictObject({
        date: z.iso.date(),
        slots: z.array(z.strictObject(availableSlotShape)),
      }),
    ),
  }),
) {}
