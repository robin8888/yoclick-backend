import { type TenantTransactionClient } from '../../../shared/database/tenant-prisma.service';
import { getUtcRangeOfLocalDates } from '../../../shared/time/zoned-time';
import { listOpeningRangesOfDate, type OpeningHours } from '../../centers/domain/opening-hours';
import {
  type RoomAgenda,
  type RoomDayView,
  type RoomSessionView,
} from '../application/ports/booking.repository';

const SESSION_INCLUDE = {
  service: { select: { id: true, name: true, color: true } },
  staffMembership: { select: { id: true, user: { select: { fullName: true } } } },
  bookings: {
    where: { status: { not: 'cancelled' } },
    select: {
      id: true,
      status: true,
      clientMembership: { select: { id: true, user: { select: { fullName: true } } } },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  },
} as const;

type StoredSession = Awaited<ReturnType<typeof listSessionsOfDay>>[number];

async function listSessionsOfDay(
  client: TenantTransactionClient,
  range: { startsAt: Date; endsAt: Date },
) {
  return client.classSession.findMany({
    where: {
      status: 'scheduled',
      startsAt: { gte: range.startsAt, lt: range.endsAt },
    },
    include: {
      service: SESSION_INCLUDE.service,
      staffMembership: SESSION_INCLUDE.staffMembership,
      bookings: {
        where: { status: { not: 'cancelled' } },
        select: SESSION_INCLUDE.bookings.select,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      },
    },
    orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
  });
}

function toRoomSessionView(session: StoredSession): RoomSessionView {
  return {
    id: session.id,
    startsAt: session.startsAt,
    endsAt: session.endsAt,
    mode: session.mode,
    capacity: session.capacity,
    bookedCount: session.bookings.length,
    service: session.service,
    teacher: {
      membershipId: session.staffMembership.id,
      fullName: session.staffMembership.user.fullName,
    },
    attendees: session.bookings.map((booking) => ({
      bookingId: booking.id,
      clientMembershipId: booking.clientMembership.id,
      fullName: booking.clientMembership.user.fullName,
      status: booking.status,
    })),
  };
}

interface StoredRoom {
  readonly id: string;
  readonly name: string;
  readonly capacity: number;
  readonly staffMembership: { id: string; user: { fullName: string } } | null;
}

function toRoomDayView(room: StoredRoom, sessions: readonly StoredSession[]): RoomDayView {
  return {
    id: room.id,
    name: room.name,
    capacity: room.capacity,
    staff:
      room.staffMembership === null
        ? null
        : {
            membershipId: room.staffMembership.id,
            fullName: room.staffMembership.user.fullName,
          },
    sessions: sessions.filter((session) => session.roomId === room.id).map(toRoomSessionView),
  };
}

/** Cada sala del centro con lo que la ocupa ese día; las citas sin sala, aparte. */
export async function listRoomAgendaInTransaction(
  client: TenantTransactionClient,
  date: string,
): Promise<RoomAgenda> {
  const center = await client.center.findFirstOrThrow({
    select: { timezone: true, openingHours: true, holidays: true },
  });
  // Ajustes escritos por esta API tras validarlos con zod.
  const holidayDates = ((center.holidays ?? []) as { date: string }[]).map(
    (holiday) => holiday.date,
  );
  const range = getUtcRangeOfLocalDates(date, date, center.timezone);
  const [rooms, sessions] = await Promise.all([
    client.room.findMany({
      where: { archivedAt: null },
      select: {
        id: true,
        name: true,
        capacity: true,
        staffMembership: { select: { id: true, user: { select: { fullName: true } } } },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    }),
    listSessionsOfDay(client, range),
  ]);

  return {
    timeZone: center.timezone,
    openingRanges: [
      ...listOpeningRangesOfDate(center.openingHours as OpeningHours | null, holidayDates, date),
    ],
    rooms: rooms.map((room) => toRoomDayView(room, sessions)),
    sessionsWithoutRoom: sessions
      .filter((session) => session.roomId === null)
      .map(toRoomSessionView),
  };
}
