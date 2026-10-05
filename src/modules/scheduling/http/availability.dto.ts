import { z } from 'zod';
import { createZodDto } from '../../../shared/http/create-zod-dto';
import { isAvailabilityRangeAllowed } from '../domain/availability-range';

export class CenterRouteParamsDto extends createZodDto(z.strictObject({ centerId: z.uuid() })) {}

export class AvailabilityQueryDto extends createZodDto(
  z
    .strictObject({
      serviceId: z.uuid(),
      from: z.iso.date(),
      to: z.iso.date(),
      staffMembershipId: z.uuid().optional(),
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
