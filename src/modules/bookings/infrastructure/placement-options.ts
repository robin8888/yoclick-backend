import { type TenantTransactionClient } from '../../../shared/database/tenant-prisma.service';
import { getUtcRangeOfLocalDates } from '../../../shared/time/zoned-time';
import { calculateAvailableSlots } from '../../scheduling/domain/available-slots';
import { loadSchedulingFacts } from '../../scheduling/infrastructure/scheduling-facts.loader';
import {
  type GroupOptions,
  type GroupOptionsQuery,
  type GroupRoomOptions,
  type PlacementOptions,
  type PlacementOptionsQuery,
} from '../application/ports/booking.repository';
import { listUsableRooms, type UsableRoom } from './usable-rooms';

async function listScheduledSessionsOfDay(
  client: TenantTransactionClient,
  range: { startsAt: Date; endsAt: Date },
) {
  return client.classSession.findMany({
    where: {
      status: 'scheduled',
      startsAt: { lt: range.endsAt },
      endsAt: { gt: range.startsAt },
    },
    select: {
      id: true,
      roomId: true,
      mode: true,
      capacity: true,
      staffMembershipId: true,
      startsAt: true,
      endsAt: true,
      service: { select: { name: true } },
      room: { select: { id: true, name: true } },
      _count: { select: { bookings: { where: { status: { not: 'cancelled' } } } } },
    },
    orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
  });
}

type DaySession = Awaited<ReturnType<typeof listScheduledSessionsOfDay>>[number];

function isRoomFreeDuring(
  room: UsableRoom,
  slot: { startsAt: Date; endsAt: Date },
  sessions: readonly DaySession[],
): boolean {
  return !sessions.some(
    (session) =>
      session.roomId === room.id &&
      session.startsAt < slot.endsAt &&
      slot.startsAt < session.endsAt,
  );
}

function listJoinableGroups(
  sessions: readonly DaySession[],
  query: PlacementOptionsQuery,
): PlacementOptions['groupSessions'] {
  return sessions.flatMap((session) =>
    session.mode === 'group' &&
    session.staffMembershipId === query.staffMembershipId &&
    session.room !== null &&
    session.startsAt > query.now &&
    session._count.bookings < session.capacity
      ? [
          {
            sessionId: session.id,
            startsAt: session.startsAt,
            endsAt: session.endsAt,
            serviceName: session.service.name,
            room: session.room,
            capacity: session.capacity,
            bookedCount: session._count.bookings,
          },
        ]
      : [],
  );
}

/**
 * Lo que puede hacer el centro con una persona del equipo un día: sus horas libres (con las salas
 * libres que puede usar a cada hora) y las clases grupales suyas a las que aún caben más personas.
 * `null` si el servicio no existe. Es solo una ayuda para elegir: al reservar se recomprueba todo.
 */
export async function listPlacementOptionsInTransaction(
  client: TenantTransactionClient,
  query: PlacementOptionsQuery,
): Promise<PlacementOptions | null> {
  const facts = await loadSchedulingFacts(client, {
    serviceId: query.serviceId,
    canSeeHiddenService: true,
    dateRange: { fromDate: query.date, toDate: query.date },
  });
  if (!facts) return null;
  const [day] = calculateAvailableSlots({
    ...facts,
    ...facts.service,
    fromDate: query.date,
    toDate: query.date,
    stepMinutes: query.stepMinutes,
    now: query.now,
    staff: facts.staff.filter((member) => member.membershipId === query.staffMembershipId),
  });
  const sessions = await listScheduledSessionsOfDay(
    client,
    getUtcRangeOfLocalDates(query.date, query.date, facts.timeZone),
  );
  const usableRooms = await listUsableRooms(client, query.staffMembershipId, {
    serviceRoomId: facts.service.roomId,
  });

  return {
    timeZone: facts.timeZone,
    hasUsableRooms: usableRooms.length > 0,
    openSlots: (day?.slots ?? []).map((slot) => ({
      startsAt: slot.startsAt,
      endsAt: slot.endsAt,
      freeRooms: usableRooms.filter((room) => isRoomFreeDuring(room, slot, sessions)),
    })),
    groupSessions: listJoinableGroups(sessions, query),
  };
}

type SchedulingFacts = NonNullable<Awaited<ReturnType<typeof loadSchedulingFacts>>>;

function buildGroupRoomOptions(input: {
  facts: SchedulingFacts;
  query: GroupOptionsQuery;
  sessions: readonly DaySession[];
  room: { id: string; name: string; capacity: number };
  teacher: SchedulingFacts['staff'][number];
}): GroupRoomOptions {
  const { facts, query, sessions, room, teacher } = input;
  const [day] = calculateAvailableSlots({
    ...facts,
    ...facts.service,
    fromDate: query.date,
    toDate: query.date,
    stepMinutes: query.stepMinutes,
    now: query.now,
    staff: [teacher],
  });
  return {
    room: {
      id: room.id,
      name: room.name,
      capacity: room.capacity,
      staff: { membershipId: teacher.membershipId, fullName: teacher.fullName },
    },
    openSlots: (day?.slots ?? [])
      .filter((slot) => isRoomFreeDuring(room, slot, sessions))
      .map(({ startsAt, endsAt }) => ({ startsAt, endsAt })),
    groupSessions: listJoinableGroups(sessions, {
      ...query,
      staffMembershipId: teacher.membershipId,
    }).filter((group) => group.room.id === room.id),
  };
}

/**
 * Para una cita grupal: cada sala donde se da el servicio con cada profesor que lo da y puede usarla
 * (la sala tiene profesor fijo o admite a cualquiera), con sus horas libres y sus grupos con plazas.
 * La sala es la del servicio; si el servicio no tiene sala fija, cualquiera de las del centro.
 */
export async function listGroupOptionsInTransaction(
  client: TenantTransactionClient,
  query: GroupOptionsQuery,
): Promise<GroupOptions | null> {
  const facts = await loadSchedulingFacts(client, {
    serviceId: query.serviceId,
    canSeeHiddenService: true,
    dateRange: { fromDate: query.date, toDate: query.date },
  });
  if (!facts) return null;
  const sessions = await listScheduledSessionsOfDay(
    client,
    getUtcRangeOfLocalDates(query.date, query.date, facts.timeZone),
  );
  const rooms = await client.room.findMany({
    where: {
      archivedAt: null,
      ...(facts.service.roomId !== null && { id: facts.service.roomId }),
    },
    select: { id: true, name: true, capacity: true, staffMembershipId: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });

  return {
    timeZone: facts.timeZone,
    rooms: rooms.flatMap((room) =>
      facts.staff
        .filter(
          (teacher) =>
            room.staffMembershipId === null || room.staffMembershipId === teacher.membershipId,
        )
        .map((teacher) => buildGroupRoomOptions({ facts, query, sessions, room, teacher })),
    ),
  };
}
