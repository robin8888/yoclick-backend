import { randomUUID } from 'node:crypto';
import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { getScheduleWeekdayOfLocalDate } from '../../src/modules/schedules/domain/schedule-rules';
import { addDaysToLocalDate, toLocalDate } from '../../src/shared/time/zoned-time';
import { BookingWorld, type CreatedTestCenter } from '../support/booking-world';
import { resetTestDatabase } from '../support/test-database';
import { createTestApplication } from './create-test-application';

interface Person {
  userId: string;
  membershipId: string;
}

interface SeriesBody {
  location: { name: string; address: string | null } | null;
  seriesId: string;
  label: string | null;
  mode: string;
  capacity: number;
  status: string;
  staff: { membershipId: string };
  room: { id: string } | null;
  days: { scheduleId: string; weekday: number; startsAtTime: string; endsAtTime: string }[];
  enrolledCount: number;
}

interface SeriesWriteBody {
  series: SeriesBody;
  skipped: { date: string; reason: string }[];
}

interface RoomSessionBody {
  id: string;
  mode: string;
  capacity: number;
  bookedCount: number;
  schedule: { seriesId: string; label: string | null } | null;
  cancelledReason: string | null;
  location: { name: string; address: string | null } | null;
  attendees: { clientMembershipId: string; source: string }[];
}

interface RoomAgendaBody {
  rooms: {
    id: string;
    sessions: RoomSessionBody[];
  }[];
}

interface EnrollBody {
  enrollments: { id: string; client: { membershipId: string } }[];
  skipped: { clientMembershipId: string; reason: string }[];
  skippedDates: unknown[];
}

const MADRID = 'Europe/Madrid';

describe('room schedules and fixed groups', () => {
  let application: NestFastifyApplication;
  let world: BookingWorld;
  let owner: string;
  let center: CreatedTestCenter;
  let teacherAna: Person;
  let staffMember: Person;
  let clients: Person[];
  let groupServiceId: string;
  let privateServiceId: string;
  let roomId: string;
  /** Mañana en la zona del centro: el primer día en que ocurre el horario. */
  let firstDate: string;

  const url = (path: string): string => `/v1/centers/${center.centerId}${path}`;
  const call = (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    body?: object,
    userId: string = owner,
  ) => world.call(method, url(path), userId, { centerId: center.centerId, ...(body && { body }) });

  async function createSeries(overrides: object = {}): Promise<SeriesWriteBody> {
    const response = await call('POST', '/schedules', {
      serviceId: groupServiceId,
      roomId,
      mode: 'group',
      weekdays: [getScheduleWeekdayOfLocalDate(firstDate)],
      startsAtTime: '18:00',
      endsAtTime: '19:00',
      startsOn: firstDate,
      label: 'Salsa de tarde',
      ...overrides,
    });
    if (response.statusCode !== 201) throw new Error(`Could not create series: ${response.body}`);
    return response.json<SeriesWriteBody>();
  }

  async function readRoomAgenda(date: string): Promise<RoomAgendaBody> {
    const response = await call('GET', `/agenda/rooms?date=${date}`);
    if (response.statusCode !== 200) throw new Error(`Agenda failed: ${response.body}`);
    return response.json<RoomAgendaBody>();
  }

  async function readRoomSessions(date: string): Promise<RoomSessionBody[]> {
    const agenda = await readRoomAgenda(date);
    return agenda.rooms.find((room) => room.id === roomId)?.sessions ?? [];
  }

  /** Un bono grande (para todos los servicios) entregado por el centro a cada persona. */
  async function giveEveryoneAPass(people: Person[]): Promise<void> {
    const rate = (
      await world.call('POST', url('/rates'), owner, {
        centerId: center.centerId,
        body: { name: 'Bono de pruebas', sessionsCount: 50, validDays: 365, priceCents: 0 },
      })
    ).json<{ id: string }>();
    for (const person of people) {
      await world.call('POST', url('/passes/assign'), owner, {
        centerId: center.centerId,
        body: { rateId: rate.id, clientMembershipId: person.membershipId },
      });
    }
  }

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
    staffMember = await world.addMember(center.centerId, 'staff', 'staff');
    clients = [
      await world.addMember(center.centerId, 'c1', 'client'),
      await world.addMember(center.centerId, 'c2', 'client'),
      await world.addMember(center.centerId, 'c3', 'client'),
    ];
    // El centro solo apunta a quien tiene un bono en vigor con clases.
    await giveEveryoneAPass(clients);
    groupServiceId = (
      await world.createService(owner, center.centerId, {
        name: 'Salsa',
        mode: 'group',
        durationMinutes: 60,
        minNoticeMinutes: 0,
        staffMembershipIds: [teacherAna.membershipId],
      })
    ).id;
    privateServiceId = (
      await world.createService(owner, center.centerId, {
        name: 'Clase particular',
        durationMinutes: 60,
        minNoticeMinutes: 0,
        staffMembershipIds: [teacherAna.membershipId],
      })
    ).id;
    roomId = (
      await call('POST', '/rooms', {
        name: 'Aula 1',
        capacity: 2,
        staffMembershipId: teacherAna.membershipId,
      })
    ).json<{ id: string }>().id;
    firstDate = addDaysToLocalDate(toLocalDate(new Date(), MADRID), 3);
  });

  afterAll(async () => {
    await application.close();
  });

  it('creates a weekly schedule and its sessions for the next eight weeks', async () => {
    const created = await createSeries();

    expect(created.series).toMatchObject({
      label: 'Salsa de tarde',
      mode: 'group',
      capacity: 2,
      status: 'active',
      staff: { membershipId: teacherAna.membershipId },
      room: { id: roomId },
      enrolledCount: 0,
    });
    expect(created.series.days).toHaveLength(1);
    expect(created.skipped).toEqual([]);

    const [firstSession] = await readRoomSessions(firstDate);
    expect(firstSession).toMatchObject({
      mode: 'group',
      capacity: 2,
      bookedCount: 0,
      schedule: { seriesId: created.series.seriesId, label: 'Salsa de tarde' },
      cancelledReason: null,
    });
    const sevenWeeksLater = addDaysToLocalDate(firstDate, 49);
    expect(await readRoomSessions(sevenWeeksLater)).toHaveLength(1);
    const listed = (await call('GET', '/schedules')).json<{ series: SeriesBody[] }>().series;
    expect(listed.map(({ seriesId }) => seriesId)).toEqual([created.series.seriesId]);
  });

  it('lists the weekly schedule of a service with its room and teacher, so clients see when it runs', async () => {
    await createSeries();

    const response = await call('GET', '/services');
    const services = response.json<{
      services: {
        id: string;
        hasSchedule: boolean;
        schedules: { startsAtTime: string; endsAtTime: string; room: { id: string } | null }[];
      }[];
    }>().services;
    const service = services.find(({ id }) => id === groupServiceId);

    expect(service?.hasSchedule).toBe(true);
    expect(service?.schedules[0]).toMatchObject({
      startsAtTime: '18:00',
      endsAtTime: '19:00',
      room: { id: roomId },
    });
    expect(services.find(({ id }) => id === privateServiceId)?.hasSchedule).toBe(false);
  });

  it('uses the room teacher when none is given, and refuses a mode the service does not offer', async () => {
    const withoutTeacher = await call('POST', '/schedules', {
      serviceId: groupServiceId,
      roomId,
      weekdays: [1, 3],
      startsAtTime: '10:00',
      endsAtTime: '11:00',
      startsOn: firstDate,
    });
    const privateAsGroup = await call('POST', '/schedules', {
      serviceId: privateServiceId,
      roomId,
      mode: 'group',
      weekdays: [2],
      startsAtTime: '10:00',
      endsAtTime: '11:00',
      startsOn: firstDate,
    });

    expect(withoutTeacher.statusCode).toBe(201);
    expect(
      withoutTeacher.json<SeriesWriteBody>().series.days.map(({ weekday }) => weekday),
    ).toEqual([1, 3]);
    expect(privateAsGroup.statusCode).toBe(409);
    expect(privateAsGroup.json<{ code: string }>().code).toBe('SESSION_MODE_NOT_ALLOWED');
  });

  it('lists the classes of a service with seats left and suggests the next one', async () => {
    await createSeries();
    const farDate = addDaysToLocalDate(firstDate, 20);

    const response = await call(
      'GET',
      `/services/${groupServiceId}/open-sessions?from=${firstDate}&to=${firstDate}`,
    );

    expect(response.statusCode).toBe(200);
    const body = response.json<{
      isScheduled: boolean;
      sessions: { id: string; remainingSeats: number; room: { id: string } | null }[];
      nextOpenStartsAt: string | null;
    }>();
    expect(body.isScheduled).toBe(true);
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0]).toMatchObject({ remainingSeats: 2, room: { id: roomId } });
    expect(body.nextOpenStartsAt).not.toBeNull();
    const empty = await call(
      'GET',
      `/services/${groupServiceId}/open-sessions?from=${addDaysToLocalDate(firstDate, 1)}&to=${addDaysToLocalDate(firstDate, 2)}`,
    );
    expect(empty.json<{ sessions: unknown[] }>().sessions).toHaveLength(0);
    expect(farDate > firstDate).toBe(true);
  });

  it('does not offer a class that is already full, and says a service has no schedule when it has none', async () => {
    const { series } = await createSeries();
    await call('POST', `/schedules/${series.seriesId}/enrollments`, {
      clientMembershipIds: [clients[0]?.membershipId, clients[1]?.membershipId],
    });

    const full = await call(
      'GET',
      `/services/${groupServiceId}/open-sessions?from=${firstDate}&to=${firstDate}`,
    );
    const free = await call(
      'GET',
      `/services/${privateServiceId}/open-sessions?from=${firstDate}&to=${firstDate}`,
    );

    expect(full.json<{ sessions: unknown[] }>().sessions).toHaveLength(0);
    expect(free.json<{ isScheduled: boolean }>().isScheduled).toBe(false);
  });

  it('refuses a free slot for a service that has a room schedule, but lets people join its classes', async () => {
    await createSeries();
    const sessions = (
      await call(
        'GET',
        `/services/${groupServiceId}/open-sessions?from=${firstDate}&to=${firstDate}`,
      )
    ).json<{ sessions: { id: string; startsAt: string }[] }>().sessions;
    const [session] = sessions;
    const freeSlot = await call('POST', '/agenda/bookings', {
      clientMembershipId: clients[0]?.membershipId,
      serviceId: groupServiceId,
      startsAt: session?.startsAt,
      mode: 'group',
    });

    const joined = await call('POST', '/agenda/bookings/join-group', {
      clientMembershipId: clients[0]?.membershipId,
      classSessionId: session?.id,
    });

    expect(freeSlot.statusCode).toBe(409);
    expect(freeSlot.json<{ code: string }>().code).toBe('SERVICE_ONLY_IN_SCHEDULE');
    expect(joined.statusCode).toBe(201);
  });

  describe('a room is not given twice at the same time', () => {
    const post = (overrides: object) =>
      call('POST', '/schedules', {
        serviceId: groupServiceId,
        roomId,
        mode: 'group',
        weekdays: [getScheduleWeekdayOfLocalDate(firstDate)],
        startsAtTime: '14:00',
        endsAtTime: '16:00',
        startsOn: firstDate,
        endsOn: addDaysToLocalDate(firstDate, 6),
        ...overrides,
      });

    it('refuses the same room at the same hours in the same dates', async () => {
      expect((await post({})).statusCode).toBe(201);

      const again = await post({});

      expect(again.statusCode).toBe(409);
      expect(again.json<{ code: string }>().code).toBe('ROOM_SCHEDULE_OVERLAP');
    });

    it.each([
      { caseName: 'starts inside the other one', startsAtTime: '15:00', endsAtTime: '17:00' },
      { caseName: 'ends inside the other one', startsAtTime: '13:00', endsAtTime: '15:00' },
      { caseName: 'contains the other one', startsAtTime: '13:00', endsAtTime: '17:00' },
      { caseName: 'is inside the other one', startsAtTime: '14:30', endsAtTime: '15:30' },
    ])('refuses an hour that $caseName', async ({ startsAtTime, endsAtTime }) => {
      await post({});

      const response = await post({ startsAtTime, endsAtTime });

      expect(response.statusCode).toBe(409);
      expect(response.json<{ code: string }>().code).toBe('ROOM_SCHEDULE_OVERLAP');
    });

    it('lets the same room and day have another hour, even right after', async () => {
      await post({});

      const after = await post({ startsAtTime: '16:00', endsAtTime: '18:00' });
      const before = await post({ startsAtTime: '12:00', endsAtTime: '14:00' });

      expect(after.statusCode).toBe(201);
      expect(before.statusCode).toBe(201);
    });

    it('lets the same hours in another week', async () => {
      await post({});

      const nextWeek = await post({
        startsOn: addDaysToLocalDate(firstDate, 7),
        endsOn: addDaysToLocalDate(firstDate, 13),
      });

      expect(nextWeek.statusCode).toBe(201);
    });

    it('refuses a schedule without end over a week that is already given', async () => {
      await post({});

      const withoutEnd = await post({ endsOn: null });

      expect(withoutEnd.statusCode).toBe(409);
    });

    it('refuses the same teacher at the same hours in another room', async () => {
      const otherRoom = (await call('POST', '/rooms', { name: 'Aula 2', capacity: 5 })).json<{
        id: string;
      }>().id;
      await post({});

      const response = await post({
        roomId: otherRoom,
        staffMembershipId: teacherAna.membershipId,
      });

      expect(response.statusCode).toBe(409);
      expect(response.json<{ code: string }>().code).toBe('TEACHER_SCHEDULE_OVERLAP');
    });

    it('does not refuse an edit that does not move anything, and refuses one that does collide', async () => {
      const first = (await post({})).json<SeriesWriteBody>();
      const second = (
        await post({ startsAtTime: '16:00', endsAtTime: '18:00' })
      ).json<SeriesWriteBody>();

      const harmless = await call('PATCH', `/schedules/${first.series.seriesId}`, {
        label: 'Karate infantil',
      });
      const collides = await call('PATCH', `/schedules/${second.series.seriesId}`, {
        startsAtTime: '15:00',
      });

      expect(harmless.statusCode).toBe(200);
      expect(collides.statusCode).toBe(409);
      expect(collides.json<{ code: string }>().code).toBe('ROOM_SCHEDULE_OVERLAP');
    });
  });

  describe('the agenda of the teacher', () => {
    it('shows the classes of the schedule that nobody has joined yet', async () => {
      await createSeries();

      const response = await call('GET', `/agenda?date=${firstDate}`, undefined, teacherAna.userId);

      expect(response.statusCode).toBe(200);
      const body = response.json<{
        entries: unknown[];
        emptySessions: { service: { id: string }; staff: { membershipId: string } }[];
      }>();
      expect(body.entries).toEqual([]);
      expect(body.emptySessions).toHaveLength(1);
      expect(body.emptySessions[0]).toMatchObject({
        service: { id: groupServiceId },
        staff: { membershipId: teacherAna.membershipId },
      });
    });

    it('stops listing the class as empty once someone joins it', async () => {
      await createSeries();
      const sessions = await call(
        'GET',
        `/services/${groupServiceId}/open-sessions?from=${firstDate}&to=${firstDate}`,
        undefined,
        clients[0]?.userId,
      );
      const sessionId = sessions.json<{ sessions: { id: string }[] }>().sessions[0]?.id ?? '';
      await world.call('POST', url('/bookings/join-session'), clients[0]?.userId, {
        centerId: center.centerId,
        headers: { 'idempotency-key': randomUUID() },
        body: { classSessionId: sessionId },
      });

      const response = await call('GET', `/agenda?date=${firstDate}`, undefined, teacherAna.userId);

      const body = response.json<{ entries: unknown[]; emptySessions: unknown[] }>();
      expect(body.entries).toHaveLength(1);
      expect(body.emptySessions).toEqual([]);
    });
  });

  describe('a client books a class of a service with a room schedule', () => {
    async function firstOpenSessionId(): Promise<string> {
      await createSeries();
      const response = await call(
        'GET',
        `/services/${groupServiceId}/open-sessions?from=${firstDate}&to=${firstDate}`,
        undefined,
        clients[0]?.userId,
      );
      return response.json<{ sessions: { id: string }[] }>().sessions[0]?.id ?? '';
    }

    const joinAsClient = (sessionId: string, person: Person | undefined) =>
      world.call('POST', url('/bookings/join-session'), person?.userId, {
        centerId: center.centerId,
        headers: { 'idempotency-key': randomUUID() },
        body: { classSessionId: sessionId },
      });

    it('joins the class with the teacher and room the center decided', async () => {
      const sessionId = await firstOpenSessionId();

      const response = await joinAsClient(sessionId, clients[0]);

      expect(response.statusCode).toBe(201);
      expect(
        response.json<{ room: { id: string } | null; session: { id: string } }>(),
      ).toMatchObject({
        room: { id: roomId },
        session: { id: sessionId },
      });
    });

    it('does not let the same person take two seats of the same class, nor a full class', async () => {
      const sessionId = await firstOpenSessionId();
      await joinAsClient(sessionId, clients[0]);
      await joinAsClient(sessionId, clients[1]);

      const twice = await joinAsClient(sessionId, clients[0]);
      const full = await joinAsClient(sessionId, clients[2]);

      expect(twice.statusCode).toBe(409);
      expect(full.statusCode).toBe(409);
      expect(full.json<{ code: string }>().code).toBe('SESSION_FULL');
    });

    it('shows a client the real seats left, counting everybody else', async () => {
      const sessionId = await firstOpenSessionId();
      await joinAsClient(sessionId, clients[0]);

      const asOtherClient = await call(
        'GET',
        `/services/${groupServiceId}/open-sessions?from=${firstDate}&to=${firstDate}`,
        undefined,
        clients[1]?.userId,
      );

      expect(asOtherClient.json<{ sessions: { remainingSeats: number }[] }>().sessions).toEqual([
        expect.objectContaining({ remainingSeats: 1 }),
      ]);
    });

    const readNotices = async (userId: string) => {
      const response = await world.call('GET', url('/notifications'), userId, {
        centerId: center.centerId,
      });
      return response.json<{ notifications: { kind: string }[] }>().notifications;
    };

    const openSessions = async (userId: string | undefined) =>
      (
        await call(
          'GET',
          `/services/${groupServiceId}/open-sessions?from=${firstDate}&to=${addDaysToLocalDate(firstDate, 7)}`,
          undefined,
          userId,
        )
      ).json<{ sessions: { id: string; remainingSeats: number }[] }>().sessions;

    it('cancels the seat of a client: it goes back to the room capacity and the teacher and the center are told', async () => {
      const sessionId = await firstOpenSessionId();
      const booking = (await joinAsClient(sessionId, clients[0])).json<{ id: string }>();
      expect((await openSessions(clients[1]?.userId))[0]?.remainingSeats).toBe(1);

      const cancelled = await world.call(
        'POST',
        url(`/bookings/${booking.id}/cancel`),
        clients[0]?.userId,
        { centerId: center.centerId },
      );

      expect(cancelled.statusCode).toBe(200);
      expect((await openSessions(clients[1]?.userId))[0]?.remainingSeats).toBe(2);
      const forTeacher = await readNotices(teacherAna.userId);
      const forOwner = await readNotices(owner);
      expect(forTeacher.map(({ kind }) => kind)).toContain('booking_cancelled');
      expect(forOwner.map(({ kind }) => kind)).toContain('booking_cancelled');
    });

    it('moves a client to another class of the service: one seat is freed and the other taken', async () => {
      await createSeries();
      await createSeries({
        weekdays: [getScheduleWeekdayOfLocalDate(addDaysToLocalDate(firstDate, 1))],
        startsOn: firstDate,
        startsAtTime: '12:00',
        endsAtTime: '13:00',
        label: 'Salsa de mediodía',
      });
      const [first, second] = await openSessions(clients[0]?.userId);
      const booking = (await joinAsClient(first?.id ?? '', clients[0])).json<{ id: string }>();

      const moved = await world.call(
        'POST',
        url(`/bookings/${booking.id}/move-to-session`),
        clients[0]?.userId,
        { centerId: center.centerId, body: { classSessionId: second?.id } },
      );

      expect(moved.statusCode).toBe(200);
      expect(moved.json<{ session: { id: string } }>().session.id).toBe(second?.id);
      const after = await openSessions(clients[1]?.userId);
      expect(after.find(({ id }) => id === first?.id)?.remainingSeats).toBe(2);
      expect(after.find(({ id }) => id === second?.id)?.remainingSeats).toBe(1);
      const forTeacher = await readNotices(teacherAna.userId);
      expect(forTeacher.map(({ kind }) => kind)).toContain('booking_rescheduled');
    });

    it('does not move a client to a class that is full', async () => {
      await createSeries();
      await createSeries({
        weekdays: [getScheduleWeekdayOfLocalDate(addDaysToLocalDate(firstDate, 1))],
        startsOn: firstDate,
        startsAtTime: '12:00',
        endsAtTime: '13:00',
      });
      const [first, second] = await openSessions(clients[0]?.userId);
      const booking = (await joinAsClient(first?.id ?? '', clients[0])).json<{ id: string }>();
      await joinAsClient(second?.id ?? '', clients[1]);
      await joinAsClient(second?.id ?? '', clients[2]);

      const moved = await world.call(
        'POST',
        url(`/bookings/${booking.id}/move-to-session`),
        clients[0]?.userId,
        { centerId: center.centerId, body: { classSessionId: second?.id } },
      );

      expect(moved.statusCode).toBe(409);
      expect(moved.json<{ code: string }>().code).toBe('SESSION_FULL');
    });

    it('does not let a client with a pass book more classes than the pass has left', async () => {
      const limited = await world.addMember(center.centerId, 'limited', 'client');
      await createSeries({
        weekdays: [0, 1, 2].map((offset) =>
          getScheduleWeekdayOfLocalDate(addDaysToLocalDate(firstDate, offset)),
        ),
      });
      const rate = (
        await call('POST', '/rates', {
          name: 'Bono 2',
          sessionsCount: 2,
          validDays: 30,
          priceCents: 2000,
          serviceIds: [],
        })
      ).json<{ id: string }>();
      await call('POST', '/passes/assign', {
        rateId: rate.id,
        clientMembershipId: limited.membershipId,
      });
      const sessions = await openSessions(limited.userId);
      expect(sessions.length).toBeGreaterThanOrEqual(3);
      const joinNth = (index: number) => joinAsClient(sessions[index]?.id ?? '', limited);

      const first = await joinNth(0);
      const second = await joinNth(1);
      const third = await joinNth(2);

      expect(first.statusCode).toBe(201);
      expect(second.statusCode).toBe(201);
      expect(third.statusCode).toBe(409);
      expect(third.json<{ code: string }>().code).toBe('PASS_FULLY_BOOKED');

      await world.call(
        'POST',
        url(`/bookings/${first.json<{ id: string }>().id}/cancel`),
        limited.userId,
        { centerId: center.centerId },
      );
      expect((await joinNth(2)).statusCode).toBe(201);
    });

    it('is only for clients: the team assigns through the agenda', async () => {
      const sessionId = await firstOpenSessionId();

      const response = await world.call('POST', url('/bookings/join-session'), owner, {
        centerId: center.centerId,
        headers: { 'idempotency-key': randomUUID() },
        body: { classSessionId: sessionId },
      });

      expect(response.statusCode).toBe(403);
    });
  });

  it('only lets the teachers of the service give it', async () => {
    const outsider = await call('POST', '/schedules', {
      serviceId: groupServiceId,
      staffMembershipId: staffMember.membershipId,
      mode: 'group',
      weekdays: [1],
      startsAtTime: '10:00',
      endsAtTime: '11:00',
      startsOn: firstDate,
    });

    expect(outsider.statusCode).toBe(409);
    expect(outsider.json<{ code: string }>().code).toBe('STAFF_NOT_FOR_SERVICE');
  });

  describe('a rental service is given without a teacher', () => {
    async function createRentalService(): Promise<string> {
      const response = await call('POST', '/services', {
        name: 'Alquiler de sala',
        durationMinutes: 60,
        mode: 'group',
        isRental: true,
        staffMembershipIds: [],
      });
      expect(response.statusCode).toBe(201);
      expect(response.json<{ isRental: boolean; staff: unknown[] }>()).toMatchObject({
        isRental: true,
        staff: [],
      });
      return response.json<{ id: string }>().id;
    }

    async function createFreeRoom(name: string): Promise<string> {
      const response = await call('POST', '/rooms', { name, capacity: 4 });
      return response.json<{ id: string }>().id;
    }

    it('creates the class without a teacher and shows it in the room agenda', async () => {
      const rentalServiceId = await createRentalService();
      const rentalRoomId = await createFreeRoom('Sala alquiler');

      const response = await call('POST', '/schedules', {
        serviceId: rentalServiceId,
        roomId: rentalRoomId,
        mode: 'group',
        weekdays: [getScheduleWeekdayOfLocalDate(firstDate)],
        startsAtTime: '20:00',
        endsAtTime: '21:00',
        startsOn: firstDate,
      });

      expect(response.statusCode).toBe(201);
      expect(response.json<{ series: { staff: unknown } }>().series.staff).toBeNull();
      const agenda = await readRoomAgenda(firstDate);
      const rentalRoom = agenda.rooms.find((room) => room.id === rentalRoomId);
      expect(rentalRoom?.sessions).toHaveLength(1);
      expect(rentalRoom?.sessions[0]).toMatchObject({ teacher: null });
    });

    it('lists the rental in the day agenda without a teacher instead of failing', async () => {
      const rentalServiceId = await createRentalService();
      const rentalRoomId = await createFreeRoom('Sala agenda alquiler');
      await call('POST', '/schedules', {
        serviceId: rentalServiceId,
        roomId: rentalRoomId,
        mode: 'group',
        weekdays: [getScheduleWeekdayOfLocalDate(firstDate)],
        startsAtTime: '20:00',
        endsAtTime: '21:00',
        startsOn: firstDate,
      });

      const response = await call('GET', `/agenda?date=${firstDate}`);

      expect(response.statusCode).toBe(200);
      const { emptySessions } = response.json<{
        emptySessions: { service: { id: string }; staff: unknown }[];
      }>();
      expect(emptySessions.find(({ service }) => service.id === rentalServiceId)).toMatchObject({
        staff: null,
      });
    });

    it('still requires a teacher when the service is not a rental', async () => {
      const rentalRoomId = await createFreeRoom('Sala sin profesor');

      const response = await call('POST', '/schedules', {
        serviceId: groupServiceId,
        roomId: rentalRoomId,
        mode: 'group',
        weekdays: [getScheduleWeekdayOfLocalDate(firstDate)],
        startsAtTime: '20:00',
        endsAtTime: '21:00',
        startsOn: firstDate,
      });

      expect(response.statusCode).toBe(400);
    });
  });

  it('lists the weekly slots a room and a teacher already have, so a new class avoids them', async () => {
    await createSeries();

    const byRoom = await call('GET', `/schedules/busy-times?roomId=${roomId}`);
    const byTeacher = await call(
      'GET',
      `/schedules/busy-times?staffMembershipId=${teacherAna.membershipId}`,
    );
    const none = await call('GET', '/schedules/busy-times');

    expect(byRoom.statusCode).toBe(200);
    expect(
      byRoom.json<{ busy: { startsAtTime: string; endsAtTime: string; source: string }[] }>().busy,
    ).toEqual([
      expect.objectContaining({ startsAtTime: '18:00', endsAtTime: '19:00', source: 'room' }),
    ]);
    expect(byTeacher.json<{ busy: unknown[] }>().busy.length).toBeGreaterThanOrEqual(0);
    expect(none.statusCode).toBe(400);
  });

  it('lets the center write to everyone enrolled in a fixed class', async () => {
    const { series } = await createSeries();
    await call('POST', `/schedules/${series.seriesId}/enrollments`, {
      clientMembershipIds: [clients[0]!.membershipId],
    });

    const sent = await call('POST', '/conversations/broadcast', {
      seriesId: series.seriesId,
      body: 'Hoy empezamos 10 minutos antes',
    });
    const unknown = await call('POST', '/conversations/broadcast', {
      seriesId: '0198f4a0-0000-7000-8000-00000000ffff',
      body: 'Hola',
    });

    expect(sent.statusCode).toBe(201);
    expect(sent.json()).toEqual({ sentCount: 1, skippedMinorCount: 0 });
    expect(unknown.statusCode).toBe(404);
    const received = await world.call(
      'GET',
      `/v1/centers/${center.centerId}/conversations`,
      clients[0]!.userId,
      {
        centerId: center.centerId,
      },
    );
    expect(
      received.json<{ conversations: { lastMessage: { body: string } }[] }>().conversations[0]
        ?.lastMessage.body,
    ).toBe('Hoy empezamos 10 minutos antes');
  });

  it('does not enrol someone without an active pass for the service of the class', async () => {
    const { series } = await createSeries();
    const withoutPass = await world.addMember(center.centerId, 'nopass', 'client');

    const enrolled = await call('POST', `/schedules/${series.seriesId}/enrollments`, {
      clientMembershipIds: [withoutPass.membershipId],
    });

    expect(enrolled.statusCode).toBe(201);
    const body = enrolled.json<EnrollBody>();
    expect(body.enrollments).toEqual([]);
    expect(body.skipped).toEqual([
      { clientMembershipId: withoutPass.membershipId, reason: 'no_active_pass' },
    ]);
  });

  it('enrolls people up to the capacity and gives them a seat in every future session', async () => {
    const { series } = await createSeries();

    const enrolled = await call('POST', `/schedules/${series.seriesId}/enrollments`, {
      clientMembershipIds: clients.map(({ membershipId }) => membershipId),
    });

    expect(enrolled.statusCode).toBe(201);
    const body = enrolled.json<EnrollBody>();
    expect(body.enrollments.map(({ client }) => client.membershipId)).toEqual([
      clients[0]!.membershipId,
      clients[1]!.membershipId,
    ]);
    expect(body.skipped).toEqual([
      { clientMembershipId: clients[2]!.membershipId, reason: 'series_full' },
    ]);
    expect(body.skippedDates).toEqual([]);

    const [firstSession] = await readRoomSessions(firstDate);
    expect(firstSession?.bookedCount).toBe(2);
    expect(firstSession?.attendees.map(({ source }) => source)).toEqual([
      'enrollment',
      'enrollment',
    ]);
    const asClient = await call(
      'GET',
      '/bookings/mine?scope=upcoming&limit=50',
      undefined,
      clients[0]!.userId,
    );
    const bookings = asClient.json<{ bookings: { source: string; room: { id: string } }[] }>()
      .bookings;
    expect(bookings.length).toBeGreaterThanOrEqual(7);
    expect(bookings[0]).toMatchObject({ source: 'enrollment', room: { id: roomId } });

    const again = await call('POST', `/schedules/${series.seriesId}/enrollments`, {
      clientMembershipIds: [clients[0]!.membershipId],
    });
    expect(again.json<EnrollBody>().skipped).toEqual([
      { clientMembershipId: clients[0]!.membershipId, reason: 'already_enrolled' },
    ]);
  });

  it('unenrolls a person: their future seats are cancelled and the others keep theirs', async () => {
    const { series } = await createSeries();
    const enrolled = (
      await call('POST', `/schedules/${series.seriesId}/enrollments`, {
        clientMembershipIds: [clients[0]!.membershipId, clients[1]!.membershipId],
      })
    ).json<EnrollBody>();

    const removed = await call(
      'DELETE',
      `/schedules/${series.seriesId}/enrollments/${enrolled.enrollments[0]!.id}`,
    );

    expect(removed.statusCode).toBe(200);
    expect(
      removed.json<{ cancelledBookingCount: number }>().cancelledBookingCount,
    ).toBeGreaterThanOrEqual(7);
    const [firstSession] = await readRoomSessions(firstDate);
    expect(firstSession?.attendees.map(({ clientMembershipId }) => clientMembershipId)).toEqual([
      clients[1]!.membershipId,
    ]);
    const listed = (await call('GET', '/schedules')).json<{ series: SeriesBody[] }>().series;
    expect(listed[0]?.enrolledCount).toBe(1);
  });

  it('cancels one day with a reason: the seats of that day go away and the session shows why', async () => {
    const { series } = await createSeries();
    await call('POST', `/schedules/${series.seriesId}/enrollments`, {
      clientMembershipIds: [clients[0]!.membershipId],
    });
    const [firstSession] = await readRoomSessions(firstDate);

    const cancelled = await call('POST', `/sessions/${firstSession!.id}/cancel`, {
      reason: 'Profesora enferma',
    });

    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json<{ affectedBookingCount: number }>().affectedBookingCount).toBe(1);
    const [afterCancel] = await readRoomSessions(firstDate);
    expect(afterCancel).toMatchObject({ cancelledReason: 'Profesora enferma', bookedCount: 0 });
    const nextWeek = addDaysToLocalDate(firstDate, 7);
    expect((await readRoomSessions(nextWeek))[0]?.bookedCount).toBe(1);
    const again = await call('POST', `/sessions/${firstSession!.id}/cancel`, {
      reason: 'Otra vez',
    });
    expect(again.statusCode).toBe(404);
  });

  it('moves one day of a series to another date: the seats go with it, the rest of the series stays and everybody is told', async () => {
    const { series } = await createSeries();
    await call('POST', `/schedules/${series.seriesId}/enrollments`, {
      clientMembershipIds: [clients[0]!.membershipId],
    });
    const [firstSession] = await readRoomSessions(firstDate);
    const newDate = addDaysToLocalDate(firstDate, 1);

    const moved = await call('POST', `/sessions/${firstSession!.id}/move`, {
      date: newDate,
      startsAtTime: '10:00',
      endsAtTime: '11:00',
    });

    expect(moved.statusCode).toBe(200);
    expect(moved.json<{ notifiedPersonCount: number }>().notifiedPersonCount).toBe(2);
    expect(await readRoomSessions(firstDate)).toHaveLength(0);
    expect((await readRoomSessions(newDate))[0]).toMatchObject({
      id: firstSession!.id,
      bookedCount: 1,
    });
    expect((await readRoomSessions(addDaysToLocalDate(firstDate, 7)))[0]?.bookedCount).toBe(1);
    const noticesOfClient = await world.call('GET', url('/notifications'), clients[0]!.userId, {
      centerId: center.centerId,
    });
    expect(
      noticesOfClient
        .json<{ notifications: { kind: string }[] }>()
        .notifications.map(({ kind }) => kind),
    ).toContain('booking_rescheduled_by_team');
  });

  it('does not move a day onto the room of another class, or into the past', async () => {
    await createSeries();
    const [firstSession] = await readRoomSessions(firstDate);
    const nextWeek = addDaysToLocalDate(firstDate, 7);
    const [nextSession] = await readRoomSessions(nextWeek);

    const overlapping = await call('POST', `/sessions/${firstSession!.id}/move`, {
      date: nextWeek,
      startsAtTime: '18:30',
      endsAtTime: '19:30',
    });
    const inThePast = await call('POST', `/sessions/${nextSession!.id}/move`, {
      date: addDaysToLocalDate(toLocalDate(new Date(), MADRID), -1),
      startsAtTime: '10:00',
      endsAtTime: '11:00',
    });
    const unknown = await call('POST', `/sessions/${randomUUID()}/move`, {
      date: nextWeek,
      startsAtTime: '10:00',
      endsAtTime: '11:00',
    });

    expect(overlapping.statusCode).toBe(409);
    expect(overlapping.json<{ code: string }>().code).toBe('ROOM_SCHEDULE_OVERLAP');
    expect(inThePast.statusCode).toBe(409);
    expect(inThePast.json<{ code: string }>().code).toBe('SESSION_NOT_MOVABLE');
    expect(unknown.statusCode).toBe(404);
  });

  describe('a class outside the rooms of the center', () => {
    const PARK = {
      name: 'Parque del Retiro',
      address: 'Plaza de la Independencia 7, Madrid',
      latitude: 40.4153,
      longitude: -3.6844,
    };
    const AUDITORIUM = {
      name: 'Auditorio Municipal',
      address: 'Calle Mayor 1, Madrid',
      latitude: 40.4168,
      longitude: -3.7038,
    };

    it('gives every session of the series its location and shows it to the people with a seat', async () => {
      const { series } = await createSeries({ location: PARK });
      await call('POST', `/schedules/${series.seriesId}/enrollments`, {
        clientMembershipIds: [clients[0]!.membershipId],
      });

      expect(series.location).toEqual(PARK);
      const [session] = await readRoomSessions(firstDate);
      expect(session?.location).toMatchObject({ name: 'Parque del Retiro' });
      const mine = await call(
        'GET',
        '/bookings/mine?scope=upcoming&limit=5',
        undefined,
        clients[0]!.userId,
      );
      expect(
        mine.json<{ bookings: { location: { name: string } | null }[] }>().bookings[0]?.location,
      ).toMatchObject({ name: 'Parque del Retiro' });
    });

    it('changes the place of the whole series, tells everybody and leaves the times alone', async () => {
      const { series } = await createSeries({ location: PARK });
      await call('POST', `/schedules/${series.seriesId}/enrollments`, {
        clientMembershipIds: [clients[0]!.membershipId],
      });

      const changed = await call('PATCH', `/schedules/${series.seriesId}`, {
        location: AUDITORIUM,
      });

      expect(changed.statusCode).toBe(200);
      expect((await readRoomSessions(firstDate))[0]?.location).toMatchObject({
        name: 'Auditorio Municipal',
      });
      expect((await readRoomSessions(addDaysToLocalDate(firstDate, 7)))[0]?.location).toMatchObject(
        {
          name: 'Auditorio Municipal',
        },
      );
      const notices = await world.call('GET', url('/notifications'), clients[0]!.userId, {
        centerId: center.centerId,
      });
      expect(
        notices.json<{ notifications: { kind: string }[] }>().notifications.map(({ kind }) => kind),
      ).toContain('schedule_updated');
      const removed = await call('PATCH', `/schedules/${series.seriesId}`, { location: null });
      expect(removed.json<SeriesWriteBody>().series.location).toBeNull();
    });

    it('moves only one day to another place', async () => {
      const { series } = await createSeries({ location: PARK });
      const [firstSession] = await readRoomSessions(firstDate);

      const moved = await call('POST', `/sessions/${firstSession!.id}/move`, {
        date: firstDate,
        startsAtTime: '18:00',
        endsAtTime: '19:00',
        location: AUDITORIUM,
      });

      expect(moved.statusCode).toBe(200);
      expect((await readRoomSessions(firstDate))[0]?.location).toMatchObject({
        name: 'Auditorio Municipal',
      });
      expect((await readRoomSessions(addDaysToLocalDate(firstDate, 7)))[0]?.location).toMatchObject(
        {
          name: 'Parque del Retiro',
        },
      );
      expect(series.status).toBe('active');
    });

    async function createOutdoorRoom(): Promise<string> {
      const response = await call('POST', '/rooms', {
        name: 'Pista exterior',
        capacity: 2,
        staffMembershipId: teacherAna.membershipId,
        place: { address: PARK.address, latitude: PARK.latitude, longitude: PARK.longitude },
      });
      expect(response.statusCode).toBe(201);
      expect(response.json<{ place: { address: string } | null }>().place?.address).toBe(
        PARK.address,
      );
      return response.json<{ id: string }>().id;
    }

    async function readNoticeKinds(userId: string): Promise<string[]> {
      const notices = await world.call('GET', url('/notifications'), userId, {
        centerId: center.centerId,
      });
      return notices
        .json<{ notifications: { kind: string }[] }>()
        .notifications.map(({ kind }) => kind);
    }

    it('takes the place of an outdoor room, and changing the room tells the people with a class in it', async () => {
      const outdoorRoomId = await createOutdoorRoom();
      const { series } = await createSeries({ roomId: outdoorRoomId });
      await call('POST', `/schedules/${series.seriesId}/enrollments`, {
        clientMembershipIds: [clients[0]!.membershipId],
      });
      const readOutdoorSession = async () =>
        (await readRoomAgenda(firstDate)).rooms.find((room) => room.id === outdoorRoomId)
          ?.sessions[0];

      expect((await readOutdoorSession())?.location).toMatchObject({
        name: 'Pista exterior',
        address: PARK.address,
      });
      const mine = await call(
        'GET',
        '/bookings/mine?scope=upcoming&limit=5',
        undefined,
        clients[0]!.userId,
      );
      expect(
        mine.json<{ bookings: { location: { name: string } | null }[] }>().bookings[0]?.location,
      ).toMatchObject({ name: 'Pista exterior' });

      const moved = await call('PATCH', `/rooms/${outdoorRoomId}`, {
        place: { address: AUDITORIUM.address, latitude: null, longitude: null },
      });

      expect(moved.statusCode).toBe(200);
      expect((await readOutdoorSession())?.location).toMatchObject({ address: AUDITORIUM.address });
      expect(await readNoticeKinds(clients[0]!.userId)).toContain('schedule_updated');
      const backInside = await call('PATCH', `/rooms/${outdoorRoomId}`, { place: null });
      expect(backInside.json<{ place: unknown }>().place).toBeNull();
      expect((await readOutdoorSession())?.location).toBeNull();
    });

    it('tells the new place when a day only changes where it is', async () => {
      await createSeries();
      await call(
        'POST',
        `/schedules/${(await readRoomSessions(firstDate))[0]!.schedule!.seriesId}/enrollments`,
        {
          clientMembershipIds: [clients[0]!.membershipId],
        },
      );
      const [session] = await readRoomSessions(firstDate);

      const moved = await call('POST', `/sessions/${session!.id}/move`, {
        date: firstDate,
        startsAtTime: '18:00',
        endsAtTime: '19:00',
        location: AUDITORIUM,
      });

      expect(moved.statusCode).toBe(200);
      expect(await readNoticeKinds(clients[0]!.userId)).toContain('schedule_updated');
      expect(await readNoticeKinds(clients[0]!.userId)).not.toContain(
        'booking_rescheduled_by_team',
      );
    });

    it('refuses coordinates that come alone', async () => {
      const response = await call('POST', '/schedules', {
        serviceId: groupServiceId,
        roomId,
        weekdays: [getScheduleWeekdayOfLocalDate(firstDate)],
        startsAtTime: '18:00',
        endsAtTime: '19:00',
        startsOn: firstDate,
        location: { name: 'Parque', address: null, latitude: 40.4, longitude: null },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  it('changes the time of a series when nobody booked loose seats, and refuses when they did', async () => {
    const { series } = await createSeries();
    await call('POST', `/schedules/${series.seriesId}/enrollments`, {
      clientMembershipIds: [clients[0]!.membershipId],
    });

    const moved = await call('PATCH', `/schedules/${series.seriesId}`, {
      startsAtTime: '19:00',
      endsAtTime: '20:00',
    });

    expect(moved.statusCode).toBe(200);
    expect(moved.json<SeriesWriteBody>().series.days[0]).toMatchObject({
      startsAtTime: '19:00',
      endsAtTime: '20:00',
    });
    const noticesOfClient = await world.call('GET', url('/notifications'), clients[0]!.userId, {
      centerId: center.centerId,
    });
    expect(
      noticesOfClient
        .json<{ notifications: { kind: string }[] }>()
        .notifications.map(({ kind }) => kind),
    ).toContain('schedule_updated');
    const sessions = await readRoomSessions(firstDate);
    const live = sessions.filter(({ cancelledReason }) => cancelledReason === null);
    expect(live).toHaveLength(1);
    expect(live[0]?.bookedCount).toBe(1);

    await call('POST', '/agenda/bookings/join-group', {
      clientMembershipId: clients[1]!.membershipId,
      classSessionId: live[0]!.id,
    });
    const refused = await call('PATCH', `/schedules/${series.seriesId}`, {
      startsAtTime: '20:00',
      endsAtTime: '21:00',
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json<{ code: string }>().code).toBe('SCHEDULE_HAS_BOOKINGS');
    const relabelled = await call('PATCH', `/schedules/${series.seriesId}`, {
      label: 'Nuevo nombre',
    });
    expect(relabelled.statusCode).toBe(200);
  });

  it('ends a series: future sessions without loose seats disappear and enrollments end', async () => {
    const { series } = await createSeries();
    await call('POST', `/schedules/${series.seriesId}/enrollments`, {
      clientMembershipIds: [clients[0]!.membershipId],
    });

    const ended = await call('POST', `/schedules/${series.seriesId}/end`);

    expect(ended.statusCode).toBe(200);
    expect(ended.json<{ keptSessionCount: number }>().keptSessionCount).toBe(0);
    const live = (await readRoomSessions(firstDate)).filter(
      ({ cancelledReason }) => cancelledReason === null,
    );
    expect(live).toEqual([]);
    const listed = (await call('GET', '/schedules')).json<{ series: SeriesBody[] }>().series;
    expect(listed[0]).toMatchObject({ status: 'ended', enrolledCount: 0 });
  });

  it('lets the team read schedules but only administration change them, and hides them from clients', async () => {
    const { series } = await createSeries();

    const asStaff = await call('GET', '/schedules', undefined, staffMember.userId);
    const staffCreate = await call(
      'POST',
      '/schedules',
      { serviceId: groupServiceId },
      staffMember.userId,
    );
    const asClient = await call('GET', '/schedules', undefined, clients[0]!.userId);
    const clientEnroll = await call(
      'POST',
      `/schedules/${series.seriesId}/enrollments`,
      { clientMembershipIds: [clients[0]!.membershipId] },
      clients[0]!.userId,
    );

    expect(asStaff.statusCode).toBe(200);
    expect(staffCreate.statusCode).toBe(403);
    expect(asClient.statusCode).toBe(403);
    expect(clientEnroll.statusCode).toBe(403);
  });
});
