import { type Prisma } from '../../../generated/prisma/client';
import { type BookingView } from '../application/ports/booking.repository';

/** Todo lo que hace falta para presentar una reserva: su sesión (hora), el servicio y quien la atiende. */
export const WITH_SESSION_DETAILS = {
  classSession: {
    include: {
      service: {
        select: {
          id: true,
          name: true,
          durationMinutes: true,
          color: true,
          cancelNoticeMinutes: true,
        },
      },
      staffMembership: { select: { id: true, user: { select: { fullName: true } } } },
    },
  },
} satisfies Prisma.BookingInclude;

export type BookingWithSessionDetails = Prisma.BookingGetPayload<{
  include: typeof WITH_SESSION_DETAILS;
}>;

export function toBookingView(booking: BookingWithSessionDetails): BookingView {
  const { classSession } = booking;
  return {
    id: booking.id,
    status: booking.status,
    startsAt: classSession.startsAt,
    endsAt: classSession.endsAt,
    service: {
      id: classSession.service.id,
      name: classSession.service.name,
      durationMinutes: classSession.service.durationMinutes,
      color: classSession.service.color,
    },
    staff: {
      membershipId: classSession.staffMembership.id,
      fullName: classSession.staffMembership.user.fullName,
    },
    cancelledAt: booking.cancelledAt,
    cancelWithinPolicy: booking.cancelWithinPolicy,
    createdAt: booking.createdAt,
  };
}
