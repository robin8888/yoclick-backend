import { type BookingView } from '../application/ports/booking.repository';

export function serializeBooking(booking: BookingView): Record<string, unknown> {
  return {
    id: booking.id,
    status: booking.status,
    startsAt: booking.startsAt.toISOString(),
    endsAt: booking.endsAt.toISOString(),
    service: booking.service,
    staff: booking.staff,
    cancelledAt: booking.cancelledAt?.toISOString() ?? null,
    cancelWithinPolicy: booking.cancelWithinPolicy,
    createdAt: booking.createdAt.toISOString(),
  };
}
