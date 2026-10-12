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
    room: booking.room,
    session: booking.session,
    cancelledAt: booking.cancelledAt?.toISOString() ?? null,
    cancelWithinPolicy: booking.cancelWithinPolicy,
    startedAt: booking.startedAt?.toISOString() ?? null,
    endedAt: booking.endedAt?.toISOString() ?? null,
    actualDurationSeconds: calculateActualDurationSeconds(booking),
    source: booking.source,
    createdAt: booking.createdAt.toISOString(),
    createdBy: booking.createdBy,
  };
}
