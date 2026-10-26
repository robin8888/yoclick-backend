import { type TenantTransactionClient } from '../../../shared/database/tenant-prisma.service';
import {
  resolveSessionLocation,
  toSessionLocation,
} from '../../../shared/location/session-location';
import { findBookingsBlockedByRefund } from '../../passes/infrastructure/refund-block';
import { requireTeacher } from './require-teacher';
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
      room: {
        select: {
          id: true,
          name: true,
          isOutdoor: true,
          placeAddress: true,
          placeLatitude: true,
          placeLongitude: true,
        },
      },
      // Plazas ocupadas de la sesión: toda reserva que no se haya cancelado.
      _count: { select: { bookings: { where: { status: { not: 'cancelled' } } } } },
    },
  },
  createdBy: { select: { id: true, user: { select: { fullName: true } } } },
} satisfies Prisma.BookingInclude;

export type BookingWithSessionDetails = Prisma.BookingGetPayload<{
  include: typeof WITH_SESSION_DETAILS;
}>;

function toCreatedByView(booking: BookingWithSessionDetails): BookingView['createdBy'] {
  if (booking.createdBy === null || booking.createdByRole === null) return null;
  return {
    membershipId: booking.createdBy.id,
    fullName: booking.createdBy.user.fullName,
    role: booking.createdByRole,
  };
}

/** Marca como bloqueadas las citas que lo estén por un reembolso total (ver `isBookingBlockedByRefund`). */
export async function markBlockedBookings(
  client: TenantTransactionClient,
  input: { bookings: readonly BookingWithSessionDetails[]; now: Date },
): Promise<BookingView[]> {
  const blockedIds = await findBookingsBlockedByRefund(client, {
    bookings: input.bookings.map((booking) => ({
      id: booking.id,
      clientMembershipId: booking.clientMembershipId,
      createdAt: booking.createdAt,
      status: booking.status,
      source: booking.source,
    })),
    now: input.now,
  });
  return input.bookings.map((booking) => ({
    ...toBookingView(booking),
    needsNewPass: blockedIds.has(booking.id),
  }));
}

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
      membershipId: requireTeacher(classSession.staffMembership).id,
      fullName: requireTeacher(classSession.staffMembership).user.fullName,
    },
    room:
      classSession.room === null
        ? null
        : { id: classSession.room.id, name: classSession.room.name },
    location: resolveSessionLocation(toSessionLocation(classSession), classSession.room),
    session: {
      id: classSession.id,
      mode: classSession.mode,
      capacity: classSession.capacity,
      bookedCount: classSession._count.bookings,
    },
    cancelledAt: booking.cancelledAt,
    cancelWithinPolicy: booking.cancelWithinPolicy,
    startedAt: booking.startedAt,
    endedAt: booking.endedAt,
    checkedInAt: booking.checkedInAt,
    source: booking.source,
    createdAt: booking.createdAt,
    // Solo las listas lo calculan (ver `markBlockedBookings`): el resto de respuestas no lo necesita.
    needsNewPass: false,
    createdBy: toCreatedByView(booking),
  };
}
