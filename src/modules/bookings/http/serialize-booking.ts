import { type BookingView } from '../application/ports/booking.repository';
import { calculateActualDurationSeconds } from '../domain/session-record';

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
    startedAt: booking.startedAt?.toISOString() ?? null,
    endedAt: booking.endedAt?.toISOString() ?? null,
    actualDurationSeconds: calculateActualDurationSeconds(booking),
    createdAt: booking.createdAt.toISOString(),
  };
}
