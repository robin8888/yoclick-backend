import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { BookingWorld, type CreatedTestCenter, type TestSlot } from '../support/booking-world';
import { resetTestDatabase } from '../support/test-database';
import { createTestApplication } from './create-test-application';

interface Person {
  userId: string;
  membershipId: string;
}

interface BookingBody {
  id: string;
  status: string;
  startsAt: string;
  staff: { membershipId: string };
  room: { id: string; name: string } | null;
  session: { id: string; mode: string; capacity: number; bookedCount: number };
}

interface RoomBody {
  id: string;
  name: string;
  capacity: number;
  staff: { membershipId: string; fullName: string } | null;
  services: { id: string; name: string }[];
}

interface PlacementBody {
  hasUsableRooms: boolean;
  openSlots: { startsAt: string; freeRooms: { id: string }[] }[];
  groupSessions: { sessionId: string; capacity: number; bookedCount: number }[];
}

describe('rooms and group appointments', () => {
  let application: NestFastifyApplication;
  let world: BookingWorld;
  let owner: string;
  let center: CreatedTestCenter;
  let teacherAna: Person;
  let teacherBen: Person;
  let clients: Person[];
  let serviceId: string;
  let slot: TestSlot;
  let roomOfAna: RoomBody;
  let roomOfBen: RoomBody;
  let sharedRoom: RoomBody;

  const url = (path: string): string => `/v1/centers/${center.centerId}${path}`;
  const call = (method: 'GET' | 'POST' | 'PATCH', path: string, body?: object) =>
    world.call(method, url(path), owner, { centerId: center.centerId, ...(body && { body }) });

  async function createRoom(name: string, capacity: number, staffMembershipId?: string) {
    const response = await call('POST', '/rooms', {
      name,
      capacity,
      ...(staffMembershipId && { staffMembershipId }),
    });
    return response.json<RoomBody>();
  }

  const assign = (client: Person, body: object = {}) =>
    call('POST', '/agenda/bookings', {
      clientMembershipId: client.membershipId,
      serviceId,
      startsAt: slot.startsAt,
      ...body,
    });

  const assignGroup = (client: Person, teacher: Person, room: RoomBody) =>
    assign(client, { staffMembershipId: teacher.membershipId, mode: 'group', roomId: room.id });

  const joinGroup = (client: Person, sessionId: string) =>
    call('POST', '/agenda/bookings/join-group', {
      clientMembershipId: client.membershipId,
      classSessionId: sessionId,
    });

  beforeAll(async () => {
    application = await createTestApplication();
    world = new BookingWorld(application);
  });

  beforeEach(async () => {
    await resetTestDatabase();
    owner = await world.fixtures.createUser('owner');
    center = await world.createCenter(owner);
    await world.openAllWeek(owner, center.centerId);
    teacherAna = await world.addMember(center.centerId, 'teacherana', 'staff');
    teacherBen = await world.addMember(center.centerId, 'teacherben', 'staff');
    clients = [
      await world.addMember(center.centerId, 'c1', 'client'),
      await world.addMember(center.centerId, 'c2', 'client'),
      await world.addMember(center.centerId, 'c3', 'client'),
    ];
    serviceId = (
      await world.createService(owner, center.centerId, {
        name: 'Salsa',
        mode: 'both',
        durationMinutes: 60,
        minNoticeMinutes: 0,
        staffMembershipIds: [teacherAna.membershipId, teacherBen.membershipId],
      })
    ).id;
    slot = (
      await world.fetchSlots(owner, center.centerId, serviceId, teacherAna.membershipId)
    )[0] as TestSlot;
    roomOfAna = await createRoom('Sala Ana', 2, teacherAna.membershipId);
    roomOfBen = await createRoom('Sala Ben', 5, teacherBen.membershipId);
    sharedRoom = await createRoom('Sala común', 3);
  });

  afterAll(async () => {
    await application.close();
  });

  it('keeps the teacher of a room, and rejects a person who is not in the team', async () => {
    const rooms = (await call('GET', '/rooms')).json<{ rooms: RoomBody[] }>().rooms;
    expect(rooms.find(({ id }) => id === roomOfAna.id)?.staff?.membershipId).toBe(
      teacherAna.membershipId,
    );

    const moved = await call('PATCH', `/rooms/${roomOfAna.id}`, {
      staffMembershipId: teacherBen.membershipId,
      capacity: 4,
    });
    const unknown = await call('PATCH', `/rooms/${roomOfAna.id}`, {
      staffMembershipId: clients[0]?.membershipId,
    });

    expect(moved.json<RoomBody>()).toMatchObject({ capacity: 4 });
    expect(moved.json<RoomBody>().staff?.membershipId).toBe(teacherBen.membershipId);
    expect(unknown.statusCode).toBe(404);
  });

  it('opens a group with the capacity of the room and shows the room on the booking', async () => {
    const response = await assignGroup(clients[0] as Person, teacherAna, roomOfAna);

    expect(response.statusCode).toBe(201);
    const booking = response.json<BookingBody>();
    expect(booking.room).toEqual({ id: roomOfAna.id, name: 'Sala Ana' });
    expect(booking.session).toMatchObject({ mode: 'group', capacity: 2, bookedCount: 1 });
  });

  it('picks a room of the teacher by itself when a group appointment names none', async () => {
    const response = await assign(clients[0] as Person, {
      staffMembershipId: teacherAna.membershipId,
      mode: 'group',
    });
    // La sala de Ana y la común son utilizables por Ana: se usa una, así que sí se crea.
    expect(response.statusCode).toBe(201);
    expect(response.json<BookingBody>().room).not.toBeNull();
  });

  it('never lets more people in than the room holds', async () => {
    const first = (
      await assignGroup(clients[0] as Person, teacherAna, roomOfAna)
    ).json<BookingBody>();
    const second = await joinGroup(clients[1] as Person, first.session.id);
    const third = await joinGroup(clients[2] as Person, first.session.id);

    expect(second.statusCode).toBe(201);
    expect(second.json<BookingBody>().session.bookedCount).toBe(2);
    expect(third.statusCode).toBe(409);
    expect(third.json<{ code: string }>().code).toBe('SESSION_FULL');
  });

  it('a seat is freed when someone cancels, and the group stays for the others', async () => {
    const first = (
      await assignGroup(clients[0] as Person, teacherAna, roomOfAna)
    ).json<BookingBody>();
    const second = (await joinGroup(clients[1] as Person, first.session.id)).json<BookingBody>();

    await call('POST', `/agenda/bookings/${second.id}/cancel`);
    const rejoined = await joinGroup(clients[2] as Person, first.session.id);

    expect(rejoined.statusCode).toBe(201);
    expect(rejoined.json<BookingBody>().session.bookedCount).toBe(2);
  });

  it('frees the room and the teacher only when the last person leaves', async () => {
    const first = (
      await assignGroup(clients[0] as Person, teacherAna, roomOfAna)
    ).json<BookingBody>();
    const busy = await assignGroup(clients[1] as Person, teacherAna, sharedRoom);
    expect(busy.statusCode).toBe(409);

    await call('POST', `/agenda/bookings/${first.id}/cancel`);
    const reopened = await assignGroup(clients[1] as Person, teacherAna, sharedRoom);

    expect(reopened.statusCode).toBe(201);
  });

  it('does not put the same teacher in two rooms at the same time', async () => {
    await assignGroup(clients[0] as Person, teacherAna, roomOfAna);

    const secondRoom = await assignGroup(clients[1] as Person, teacherAna, sharedRoom);

    expect(secondRoom.statusCode).toBe(409);
    expect(secondRoom.json<{ code: string }>().code).toBe('SLOT_UNAVAILABLE');
  });

  it('does not put two teachers in the same room at the same time', async () => {
    await assignGroup(clients[0] as Person, teacherAna, sharedRoom);

    const sameRoom = await assignGroup(clients[1] as Person, teacherBen, sharedRoom);

    expect(sameRoom.statusCode).toBe(409);
    expect(sameRoom.json<{ code: string }>().code).toBe('ROOM_UNAVAILABLE');
  });

  it('does not put a teacher in a room that belongs to another teacher', async () => {
    const response = await assignGroup(clients[0] as Person, teacherBen, roomOfAna);

    expect(response.statusCode).toBe(409);
    expect(response.json<{ code: string }>().code).toBe('ROOM_UNAVAILABLE');
  });

  it('does not put the same student in two rooms at the same time', async () => {
    await assignGroup(clients[0] as Person, teacherAna, roomOfAna);

    const otherRoom = await assignGroup(clients[0] as Person, teacherBen, roomOfBen);

    expect(otherRoom.statusCode).toBe(409);
    expect(otherRoom.json<{ code: string }>().code).toBe('ALREADY_BOOKED');
  });

  it('does not let a student join a second group that overlaps the one they are in', async () => {
    await assignGroup(clients[0] as Person, teacherAna, roomOfAna);
    const benGroup = (
      await assignGroup(clients[1] as Person, teacherBen, roomOfBen)
    ).json<BookingBody>();

    const response = await joinGroup(clients[0] as Person, benGroup.session.id);

    expect(response.statusCode).toBe(409);
    expect(response.json<{ code: string }>().code).toBe('ALREADY_BOOKED');
  });

  it('does not let a group booking be moved: it is cancelled and assigned again', async () => {
    const booking = (
      await assignGroup(clients[0] as Person, teacherAna, roomOfAna)
    ).json<BookingBody>();
    const later = new Date(Date.parse(slot.startsAt) + 2 * 3_600_000).toISOString();

    const response = await call('POST', `/agenda/bookings/${booking.id}/reschedule`, {
      startsAt: later,
    });

    expect(response.statusCode).toBe(409);
    expect(response.json<{ code: string }>().code).toBe('BOOKING_NOT_RESCHEDULABLE');
  });

  it('lets the teacher cancel an appointment of their agenda but not move it', async () => {
    const booking = (
      await assign(clients[0] as Person, { staffMembershipId: teacherAna.membershipId })
    ).json<BookingBody>();
    const later = new Date(Date.parse(slot.startsAt) + 2 * 3_600_000).toISOString();

    const moved = await world.call(
      'POST',
      url(`/agenda/bookings/${booking.id}/reschedule`),
      teacherAna.userId,
      { centerId: center.centerId, body: { startsAt: later } },
    );
    const cancelled = await world.call(
      'POST',
      url(`/agenda/bookings/${booking.id}/cancel`),
      teacherAna.userId,
      { centerId: center.centerId },
    );

    expect(moved.statusCode).toBe(403);
    expect(cancelled.statusCode).toBe(200);
  });

  it('a private appointment takes a free room of the teacher and blocks it', async () => {
    const privateBooking = await assign(clients[0] as Person, {
      staffMembershipId: teacherAna.membershipId,
      mode: 'private',
      roomId: sharedRoom.id,
    });

    expect(privateBooking.statusCode).toBe(201);
    expect(privateBooking.json<BookingBody>().session).toMatchObject({
      mode: 'private',
      capacity: 1,
    });
    const another = await assign(clients[1] as Person, {
      staffMembershipId: teacherBen.membershipId,
      mode: 'private',
      roomId: sharedRoom.id,
    });
    expect(another.statusCode).toBe(409);
  });

  it('lists the free rooms of an hour and the groups that still have room', async () => {
    const group = (
      await assignGroup(clients[0] as Person, teacherAna, roomOfAna)
    ).json<BookingBody>();
    const date = slot.startsAt.slice(0, 10);

    const options = (
      await call(
        'GET',
        `/agenda/placement-options?date=${date}&serviceId=${serviceId}&staffMembershipId=${teacherAna.membershipId}`,
      )
    ).json<PlacementBody>();

    const atSlot = options.openSlots.find(({ startsAt }) => startsAt === slot.startsAt);
    expect(atSlot).toBeUndefined();
    expect(options.hasUsableRooms).toBe(true);
    expect(options.groupSessions).toEqual([
      expect.objectContaining({ sessionId: group.session.id, capacity: 2, bookedCount: 1 }),
    ]);
    const freeRoomsElsewhere = options.openSlots.flatMap(({ freeRooms }) => freeRooms);
    expect(freeRoomsElsewhere.length).toBeGreaterThan(0);
  });

  it('sets the services given in a room from the room, and the service shows its room', async () => {
    const updated = await call('PATCH', `/rooms/${roomOfAna.id}`, { serviceIds: [serviceId] });

    expect(updated.statusCode).toBe(200);
    expect(updated.json<RoomBody>().services.map(({ id }) => id)).toEqual([serviceId]);
    const services = (await call('GET', '/services')).json<{
      services: { id: string; room: { id: string } | null }[];
    }>().services;
    expect(services.find(({ id }) => id === serviceId)?.room?.id).toBe(roomOfAna.id);

    const cleared = await call('PATCH', `/rooms/${roomOfAna.id}`, { serviceIds: [] });
    expect(cleared.json<RoomBody>().services).toEqual([]);
  });

  it('rejects a service that does not exist in the center', async () => {
    const response = await call('PATCH', `/rooms/${roomOfAna.id}`, {
      serviceIds: ['0191d6a0-0000-7000-8000-000000000999'],
    });

    expect(response.statusCode).toBe(404);
  });

  it('gives a service only in its room: another room is refused', async () => {
    await call('PATCH', `/rooms/${sharedRoom.id}`, { serviceIds: [serviceId] });

    const otherRoom = await assign(clients[0] as Person, {
      staffMembershipId: teacherAna.membershipId,
      mode: 'private',
      roomId: roomOfAna.id,
    });
    const automatic = await assign(clients[1] as Person, {
      staffMembershipId: teacherBen.membershipId,
      mode: 'private',
    });

    expect(otherRoom.statusCode).toBe(409);
    expect(otherRoom.json<{ code: string }>().code).toBe('ROOM_UNAVAILABLE');
    expect(automatic.statusCode).toBe(201);
    expect(automatic.json<BookingBody>().room?.id).toBe(sharedRoom.id);
  });

  it('lists, for a group, the rooms with their teacher and free hours', async () => {
    const date = slot.startsAt.slice(0, 10);
    await assignGroup(clients[0] as Person, teacherAna, roomOfAna);

    const response = await call('GET', `/agenda/group-options?date=${date}&serviceId=${serviceId}`);

    expect(response.statusCode).toBe(200);
    const { rooms } = response.json<{
      rooms: {
        room: { id: string; staff: { membershipId: string } };
        openSlots: { startsAt: string }[];
        groupSessions: { capacity: number; bookedCount: number }[];
      }[];
    }>();
    // Sala de Ana (solo Ana), sala de Ben (solo Ben) y la común (cualquiera de los dos).
    expect(rooms.map(({ room }) => `${room.id}:${room.staff.membershipId}`)).toEqual([
      `${roomOfAna.id}:${teacherAna.membershipId}`,
      `${roomOfBen.id}:${teacherBen.membershipId}`,
      `${sharedRoom.id}:${teacherAna.membershipId}`,
      `${sharedRoom.id}:${teacherBen.membershipId}`,
    ]);
    const anaRoom = rooms.find(({ room }) => room.id === roomOfAna.id);
    expect(anaRoom?.room.staff.membershipId).toBe(teacherAna.membershipId);
    expect(anaRoom?.openSlots.map(({ startsAt }) => startsAt)).not.toContain(slot.startsAt);
    expect(anaRoom?.groupSessions).toEqual([
      expect.objectContaining({ capacity: 2, bookedCount: 1 }),
    ]);
  });

  it('assigns services to a teacher from the teacher, and replaces them', async () => {
    const extra = (
      await world.createService(owner, center.centerId, {
        name: 'Bachata',
        durationMinutes: 60,
        staffMembershipIds: [teacherBen.membershipId],
      })
    ).id;

    const assigned = await call('PATCH', `/team/${teacherAna.membershipId}`, {
      serviceIds: [extra],
    });

    expect(assigned.statusCode).toBe(200);
    expect(assigned.json<{ services: { id: string }[] }>().services.map(({ id }) => id)).toEqual([
      extra,
    ]);
    const services = (await call('GET', '/services')).json<{
      services: { id: string; staff: { membershipId: string }[] }[];
    }>().services;
    expect(
      services.find(({ id }) => id === serviceId)?.staff.map(({ membershipId }) => membershipId),
    ).toEqual([teacherBen.membershipId]);
    const unknown = await call('PATCH', `/team/${teacherAna.membershipId}`, {
      serviceIds: ['0191d6a0-0000-7000-8000-000000000999'],
    });
    expect(unknown.statusCode).toBe(404);
  });

  it('shows the agenda by room: what occupies each room, its teacher, seats and students', async () => {
    const first = (
      await assignGroup(clients[0] as Person, teacherAna, roomOfAna)
    ).json<BookingBody>();
    await joinGroup(clients[1] as Person, first.session.id);
    await assign(clients[2] as Person, {
      staffMembershipId: teacherBen.membershipId,
      mode: 'private',
      roomId: sharedRoom.id,
    });
    const date = slot.startsAt.slice(0, 10);

    const response = await call('GET', `/agenda/rooms?date=${date}`);

    expect(response.statusCode).toBe(200);
    const agenda = response.json<{
      openingRanges: { opensAt: string; closesAt: string }[];
      rooms: {
        id: string;
        capacity: number;
        staff: { membershipId: string } | null;
        sessions: {
          mode: string;
          capacity: number;
          bookedCount: number;
          startsAt: string;
          teacher: { membershipId: string };
          attendees: { fullName: string }[];
        }[];
      }[];
      sessionsWithoutRoom: unknown[];
    }>();
    expect(agenda.openingRanges.length).toBeGreaterThan(0);
    const anaRoom = agenda.rooms.find(({ id }) => id === roomOfAna.id);
    expect(anaRoom?.staff?.membershipId).toBe(teacherAna.membershipId);
    expect(anaRoom?.capacity).toBe(2);
    expect(anaRoom?.sessions).toEqual([
      expect.objectContaining({
        mode: 'group',
        capacity: 2,
        bookedCount: 2,
        startsAt: slot.startsAt,
        teacher: expect.objectContaining({ membershipId: teacherAna.membershipId }) as object,
      }),
    ]);
    expect(anaRoom?.sessions[0]?.attendees).toHaveLength(2);
    const sharedSessions = agenda.rooms.find(({ id }) => id === sharedRoom.id)?.sessions;
    expect(sharedSessions?.[0]).toMatchObject({ mode: 'private', bookedCount: 1 });
    expect(agenda.rooms.find(({ id }) => id === roomOfBen.id)?.sessions).toEqual([]);
    expect(agenda.sessionsWithoutRoom).toEqual([]);
  });

  it('keeps the room agenda for the center only', async () => {
    const date = slot.startsAt.slice(0, 10);

    const asTeacher = await world.call(
      'GET',
      url(`/agenda/rooms?date=${date}`),
      teacherAna.userId,
      {
        centerId: center.centerId,
      },
    );

    expect(asTeacher.statusCode).toBe(403);
  });
});
