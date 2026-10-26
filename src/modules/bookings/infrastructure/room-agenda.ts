import { type TenantTransactionClient } from '../../../shared/database/tenant-prisma.service';
import {
  resolveSessionLocation,
  toSessionLocation,
  type RoomPlaceColumns,
} from '../../../shared/location/session-location';
import { getUtcRangeOfLocalDates, toLocalDate } from '../../../shared/time/zoned-time';
import { listOpeningRangesOfDate, type OpeningHours } from '../../centers/domain/opening-hours';
import { materializeSchedulesInTransaction } from '../../schedules/infrastructure/schedule-materialization';
import {
  type RoomAgenda,
  type RoomDayView,
  type RoomSessionView,
} from '../application/ports/booking.repository';

const SESSION_INCLUDE = {
  service: { select: { id: true, name: true, color: true } },
  staffMembership: { select: { id: true, user: { select: { fullName: true } } } },
  schedule: { select: { seriesId: true, label: true } },
  bookings: {
    where: { status: { not: 'cancelled' } },
    select: {
      id: true,
      status: true,
      source: true,
      clientMembership: {
        select: { id: true, user: { select: { fullName: true, photoKey: true } } },
      },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  },
} as const;

type StoredSession = Awaited<ReturnType<typeof listSessionsOfDay>>[number];

/** Las sesiones del día: las programadas y las de horario canceladas ese día (para que el centro las vea). */
async function listSessionsOfDay(
  client: TenantTransactionClient,
  range: { startsAt: Date; endsAt: Date },
) {
  return client.classSession.findMany({
    where: {
      OR: [
        { status: 'scheduled' },
        { status: 'cancelled', scheduleId: { not: null }, cancelledReason: { not: null } },
      ],
      startsAt: { gte: range.startsAt, lt: range.endsAt },
    },
    include: {
      service: SESSION_INCLUDE.service,
      staffMembership: SESSION_INCLUDE.staffMembership,
      schedule: SESSION_INCLUDE.schedule,
      bookings: {
        where: { status: { not: 'cancelled' } },
        select: SESSION_INCLUDE.bookings.select,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      },
    },
    orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
  });
}

function toRoomSessionView(session: StoredSession, room: StoredRoom | null): RoomSessionView {
  return {
    id: session.id,
    startsAt: session.startsAt,
    endsAt: session.endsAt,
    mode: session.mode,
    capacity: session.capacity,
    bookedCount: session.bookings.length,
    service: session.service,
    teacher:
      session.staffMembership === null
        ? null
        : {
            membershipId: session.staffMembership.id,
            fullName: session.staffMembership.user.fullName,
          },
    schedule: session.schedule,
    location: resolveSessionLocation(toSessionLocation(session), room),
    cancelledReason: session.status === 'cancelled' ? session.cancelledReason : null,
    attendees: session.bookings.map((booking) => ({
      bookingId: booking.id,
      clientMembershipId: booking.clientMembership.id,
      fullName: booking.clientMembership.user.fullName,
      photoKey: booking.clientMembership.user.photoKey,
      status: booking.status,
      source: booking.source,
    })),
  };
}

interface StoredRoom extends RoomPlaceColumns {
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
    sessions: sessions
      .filter((session) => session.roomId === room.id)
      .map((session) => toRoomSessionView(session, room)),
  };
}

/** Las salas del centro con lo necesario para pintar su día, también si son un espacio exterior. */
async function listRoomsOfCenter(client: TenantTransactionClient) {
  return client.room.findMany({
    where: { archivedAt: null },
    select: {
      id: true,
      name: true,
      capacity: true,
      isOutdoor: true,
      placeAddress: true,
      placeLatitude: true,
      placeLongitude: true,
      staffMembership: { select: { id: true, user: { select: { fullName: true } } } },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
}

/** Cada sala del centro con lo que la ocupa ese día (sus clases); las citas sin sala, aparte. */
export async function listRoomAgendaInTransaction(
  client: TenantTransactionClient,
  date: string,
): Promise<RoomAgenda> {
  const center = await client.center.findFirstOrThrow({
    select: { timezone: true, openingHours: true, holidays: true },
  });
  // Las sesiones de horario deben existir antes de leer la agenda (es idempotente y barato).
  await materializeSchedulesInTransaction(client, {
    today: toLocalDate(new Date(), center.timezone),
  });
  // Ajustes escritos por esta API tras validarlos con zod.
  const holidayDates = ((center.holidays ?? []) as { date: string }[]).map(
    (holiday) => holiday.date,
  );
  const range = getUtcRangeOfLocalDates(date, date, center.timezone);
  const [rooms, sessions] = await Promise.all([
    listRoomsOfCenter(client),
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
      .map((session) => toRoomSessionView(session, null)),
  };
}
