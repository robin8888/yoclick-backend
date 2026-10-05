import { z } from 'zod';
import { createZodDto } from '../../../shared/http/create-zod-dto';

const MIN_PAGE_SIZE = 1;
const MAX_MY_BOOKINGS_PAGE_SIZE = 50;
const DEFAULT_MY_BOOKINGS_PAGE_SIZE = 20;

export class CenterRouteParamsDto extends createZodDto(z.strictObject({ centerId: z.uuid() })) {}

export class BookingRouteParamsDto extends createZodDto(
  z.strictObject({ centerId: z.uuid(), bookingId: z.uuid() }),
) {}

export class CreateBookingRequestDto extends createZodDto(
  z.strictObject({
    serviceId: z.uuid(),
    /** UTC con `Z`. Debe coincidir exactamente con un hueco de `GET /availability`. */
    startsAt: z.iso.datetime(),
    staffMembershipId: z.uuid().optional(),
  }),
) {}

export class MyBookingsQueryDto extends createZodDto(
  z.strictObject({
    scope: z.enum(['upcoming', 'past']).default('upcoming'),
    limit: z.coerce
      .number()
      .int()
      .min(MIN_PAGE_SIZE)
      .max(MAX_MY_BOOKINGS_PAGE_SIZE)
      .default(DEFAULT_MY_BOOKINGS_PAGE_SIZE),
  }),
) {}

export class AgendaQueryDto extends createZodDto(
  z.strictObject({ date: z.iso.date(), staffMembershipId: z.uuid().optional() }),
) {}

const bookingShape = {
  id: z.uuid(),
  status: z.enum(['confirmed', 'cancelled', 'attended', 'no_show']),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  service: z.strictObject({
    id: z.uuid(),
    name: z.string(),
    durationMinutes: z.number().int(),
    color: z.string().nullable(),
  }),
  staff: z.strictObject({ membershipId: z.uuid(), fullName: z.string() }),
  cancelledAt: z.iso.datetime().nullable(),
  /** Si se canceló con la antelación de la política; `null` mientras no se cancele. */
  cancelWithinPolicy: z.boolean().nullable(),
  createdAt: z.iso.datetime(),
};

export class BookingResponseDto extends createZodDto(z.strictObject(bookingShape)) {}

export class MyBookingsResponseDto extends createZodDto(
  z.strictObject({ bookings: z.array(z.strictObject(bookingShape)) }),
) {}

export class CancelBookingResponseDto extends createZodDto(
  z.strictObject({
    booking: z.strictObject(bookingShape),
    /** Quedaba al menos la antelación que marca la política (o el propio servicio). */
    withinPolicy: z.boolean(),
  }),
) {}

export class AgendaResponseDto extends createZodDto(
  z.strictObject({
    date: z.iso.date(),
    timezone: z.string(),
    entries: z.array(
      z.strictObject({
        booking: z.strictObject(bookingShape),
        client: z.strictObject({ membershipId: z.uuid(), fullName: z.string() }),
      }),
    ),
  }),
) {}
