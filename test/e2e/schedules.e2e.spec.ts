import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { getScheduleWeekdayOfLocalDate } from '../../src/modules/schedules/domain/schedule-rules';
import {
  addDaysToLocalDate,
  toLocalDate,
  zonedDateTimeToUtc,
} from '../../src/shared/time/zoned-time';
import { BookingWorld, type CreatedTestCenter } from '../support/booking-world';
import { resetTestDatabase } from '../support/test-database';
import { createTestApplication } from './create-test-application';

interface Person {
  userId: string;
  membershipId: string;
}

interface SeriesBody {
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
  attendees: { clientMembershipId: string; source: string }[];
}

interface RoomAgendaBody {
  rooms: {
    id: string;
    sessions: RoomSessionBody[];
    blocks: { id: string; reason: string }[];
  }[];
}

interface EnrollBody {
  enrollments: { id: string; client: { membershipId: string } }[];
  skipped: { clientMembershipId: string; reason: string }[];
  skippedDates: unknown[];
}

const MADRID = 'Europe/Madrid';

describe('room schedules, fixed groups and room blocks', () => {
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
    firstDate = addDaysToLocalDate(toLocalDate(new Date(), MADRID), 1);
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

  it('blocks a room: schedule sessions inside are cancelled and no appointment can use it', async () => {
    const { series } = await createSeries();
    await call('POST', `/schedules/${series.seriesId}/enrollments`, {
      clientMembershipIds: [clients[0]!.membershipId],
    });

    const blocked = await call('POST', `/rooms/${roomId}/blocks`, {
      startsAt: zonedDateTimeToUtc(firstDate, '17:00', MADRID).toISOString(),
      endsAt: zonedDateTimeToUtc(firstDate, '20:00', MADRID).toISOString(),
      reason: 'rental',
      note: 'Alquilada a la asociación de vecinos',
    });

    expect(blocked.statusCode).toBe(201);
    expect(blocked.json<{ cancelledSessionCount: number }>().cancelledSessionCount).toBe(1);
    const agenda = await readRoomAgenda(firstDate);
    const room = agenda.rooms.find(({ id }) => id === roomId);
    expect(room?.blocks).toEqual([expect.objectContaining({ reason: 'rental' })]);
    expect(room?.sessions[0]).toMatchObject({ cancelledReason: 'blocked', bookedCount: 0 });

    const appointment = await call('POST', '/agenda/bookings', {
      clientMembershipId: clients[1]!.membershipId,
      serviceId: privateServiceId,
      startsAt: zonedDateTimeToUtc(firstDate, '18:00', MADRID).toISOString(),
      staffMembershipId: teacherAna.membershipId,
      roomId,
    });
    expect(appointment.statusCode).toBe(409);
    expect(appointment.json<{ code: string }>().code).toBe('ROOM_UNAVAILABLE');

    const overlapping = await call('POST', `/rooms/${roomId}/blocks`, {
      startsAt: zonedDateTimeToUtc(firstDate, '19:00', MADRID).toISOString(),
      endsAt: zonedDateTimeToUtc(firstDate, '21:00', MADRID).toISOString(),
      reason: 'event',
    });
    expect(overlapping.statusCode).toBe(409);

    const removed = await call(
      'DELETE',
      `/rooms/${roomId}/blocks/${blocked.json<{ block: { id: string } }>().block.id}`,
    );
    expect(removed.statusCode).toBe(204);
  });

  it('refuses to block a room over a session that has single appointments', async () => {
    const { series } = await createSeries();
    const [firstSession] = await readRoomSessions(firstDate);
    const joined = await call('POST', '/agenda/bookings/join-group', {
      clientMembershipId: clients[0]!.membershipId,
      classSessionId: firstSession!.id,
    });
    expect(joined.statusCode).toBe(201);

    const blocked = await call('POST', `/rooms/${roomId}/blocks`, {
      startsAt: zonedDateTimeToUtc(firstDate, '17:00', MADRID).toISOString(),
      endsAt: zonedDateTimeToUtc(firstDate, '20:00', MADRID).toISOString(),
      reason: 'maintenance',
    });

    expect(blocked.statusCode).toBe(409);
    expect(blocked.json<{ code: string }>().code).toBe('ROOM_HAS_BOOKINGS');
    expect(series.seriesId).toBeDefined();
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
