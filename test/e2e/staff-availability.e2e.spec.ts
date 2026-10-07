import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { addDaysToLocalDate, toLocalDate } from '../../src/shared/time/zoned-time';
import { BookingWorld, firstSlotAtLeast, localDateOf } from '../support/booking-world';
import { resetTestDatabase } from '../support/test-database';
import { createTestApplication } from './create-test-application';

const MONDAY_INDEX = 1;
const SPAN_DAYS = 13;
const MIN_HOURS_AHEAD = 24;

interface AvailabilityBody {
  weeklyHours: Record<string, { opensAt: string; closesAt: string }[]> | null;
  absences: { id: string; startsOn: string; endsOn: string; reason: string }[];
}

describe('team availability: own hours and absences', () => {
  let application: NestFastifyApplication;
  let world: BookingWorld;
  let ownerUserId: string;
  let centerId: string;
  let serviceId: string;
  let marta: { userId: string; membershipId: string };
  let luis: { userId: string; membershipId: string };
  let ana: { userId: string; membershipId: string };

  const availabilityUrl = (membershipId = marta.membershipId): string =>
    `/v1/centers/${centerId}/team/${membershipId}/availability`;
  const absencesUrl = (membershipId = marta.membershipId): string =>
    `/v1/centers/${centerId}/team/${membershipId}/absences`;
  const call = (
    method: 'GET' | 'PUT' | 'POST' | 'DELETE',
    url: string,
    userId: string,
    body?: object,
  ) => world.call(method, url, userId, { centerId, ...(body && { body }) });
  const saveHours = (userId: string, weeklyHours: object | null, membershipId?: string) =>
    call('PUT', availabilityUrl(membershipId), userId, { weeklyHours });
  const addAbsence = (userId: string, body: object, membershipId?: string) =>
    call('POST', absencesUrl(membershipId), userId, body);
  const today = (): string => toLocalDate(new Date(), 'Europe/Madrid');

  beforeAll(async () => {
    application = await createTestApplication();
    world = new BookingWorld(application);
  });

  beforeEach(async () => {
    await resetTestDatabase();
    ownerUserId = await world.fixtures.createUser('owner');
    centerId = (await world.createCenter(ownerUserId)).centerId;
    await world.openAllWeek(ownerUserId, centerId);
    marta = await world.addMember(centerId, 'marta', 'staff');
    luis = await world.addMember(centerId, 'luis', 'staff');
    ana = await world.addMember(centerId, 'ana', 'client');
    serviceId = (
      await world.createService(ownerUserId, centerId, {
        name: 'Sesión personal',
        durationMinutes: 60,
        staffMembershipIds: [marta.membershipId],
      })
    ).id;
  });

  afterAll(async () => {
    await application.close();
  });

  it('starts with no own hours and no absences', async () => {
    const response = await call('GET', availabilityUrl(), ownerUserId);

    expect(response.statusCode).toBe(200);
    expect(response.json<AvailabilityBody>()).toEqual({ weeklyHours: null, absences: [] });
  });

  it('lets a staff member manage their own, but not somebody else, and never a client', async () => {
    expect((await saveHours(marta.userId, { mon: [] })).statusCode).toBe(200);
    expect((await saveHours(luis.userId, { mon: [] })).statusCode).toBe(403);
    expect((await saveHours(ana.userId, { mon: [] })).statusCode).toBe(403);
    expect((await call('GET', availabilityUrl(), luis.userId)).statusCode).toBe(403);
  });

  it('offers slots only inside the own hours', async () => {
    await saveHours(ownerUserId, { mon: [{ opensAt: '09:00', closesAt: '10:00' }] });

    const slots = await world.fetchSlots(ana.userId, centerId, serviceId);

    expect(slots.length).toBeGreaterThan(0);
    for (const slot of slots) {
      const date = new Date(`${localDateOf(slot.startsAt)}T00:00:00Z`);
      expect(date.getUTCDay()).toBe(MONDAY_INDEX);
    }
  });

  it('goes back to the center hours when the own hours are removed', async () => {
    await saveHours(ownerUserId, { mon: [] });
    expect(await world.fetchSlots(ana.userId, centerId, serviceId)).toHaveLength(0);

    await saveHours(ownerUserId, null);

    expect((await world.fetchSlots(ana.userId, centerId, serviceId)).length).toBeGreaterThan(0);
    expect((await call('GET', availabilityUrl(), ownerUserId)).json<AvailabilityBody>()).toEqual({
      weeklyHours: null,
      absences: [],
    });
  });

  it('offers nothing while the only person of the service is away, and again once it is removed', async () => {
    const response = await addAbsence(marta.userId, {
      startsOn: today(),
      endsOn: addDaysToLocalDate(today(), SPAN_DAYS),
      reason: 'vacation',
    });
    expect(response.statusCode).toBe(201);
    expect(await world.fetchSlots(ana.userId, centerId, serviceId)).toHaveLength(0);

    const { id } = response.json<{ id: string }>();
    const removal = await call('DELETE', `${absencesUrl()}/${id}`, marta.userId);

    expect(removal.statusCode).toBe(204);
    expect((await world.fetchSlots(ana.userId, centerId, serviceId)).length).toBeGreaterThan(0);
  });

  it('refuses to book a slot of a day the person is away', async () => {
    const slots = await world.fetchSlots(ana.userId, centerId, serviceId);
    const slot = firstSlotAtLeast(slots, MIN_HOURS_AHEAD);
    const date = localDateOf(slot.startsAt);
    await addAbsence(ownerUserId, { startsOn: date, endsOn: date, reason: 'training' });

    const booking = await world.book(ana.userId, centerId, { serviceId, startsAt: slot.startsAt });

    expect(booking.statusCode).toBe(409);
  });

  it('counts the bookings that were already in the days of a new absence', async () => {
    const slots = await world.fetchSlots(ana.userId, centerId, serviceId);
    const slot = firstSlotAtLeast(slots, MIN_HOURS_AHEAD);
    await world.book(ana.userId, centerId, { serviceId, startsAt: slot.startsAt });
    const date = localDateOf(slot.startsAt);

    const response = await addAbsence(ownerUserId, {
      startsOn: date,
      endsOn: date,
      reason: 'personal',
    });

    expect(response.json<{ affectedBookingCount: number }>().affectedBookingCount).toBe(1);
  });

  it.each([
    [
      'an end before the start',
      { startsOn: '2026-11-10', endsOn: '2026-11-09', reason: 'vacation' },
    ],
    ['an unknown reason', { startsOn: '2026-11-09', endsOn: '2026-11-10', reason: 'holiday' }],
    [
      'an absence of more than a year',
      { startsOn: '2026-01-01', endsOn: '2027-06-01', reason: 'other' },
    ],
  ])('rejects %s', async (_name, body) => {
    expect((await addAbsence(ownerUserId, body)).statusCode).toBe(400);
  });

  it('rejects own hours that close before they open', async () => {
    const response = await saveHours(ownerUserId, {
      mon: [{ opensAt: '12:00', closesAt: '09:00' }],
    });

    expect(response.statusCode).toBe(400);
  });

  it('answers 404 for somebody who is not in the team', async () => {
    expect((await call('GET', availabilityUrl(ana.membershipId), ownerUserId)).statusCode).toBe(
      404,
    );
  });
});
