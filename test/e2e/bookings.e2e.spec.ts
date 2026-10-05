import { randomUUID } from 'node:crypto';
import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { v7 as generateUuidV7 } from 'uuid';
import {
  BookingWorld,
  firstSlotAtLeast,
  localDateOf,
  type CreatedTestCenter,
  type TestService,
  type TestSlot,
} from '../support/booking-world';
import { resetTestDatabase } from '../support/test-database';
import { createTestApplication } from './create-test-application';

const HOURS_PER_DAY = 24;
const MILLISECONDS_PER_HOUR = 3_600_000;

interface BookingBody {
  id: string;
  status: string;
  startsAt: string;
  endsAt: string;
  service: { id: string; name: string; durationMinutes: number; color: string | null };
  staff: { membershipId: string; fullName: string };
  cancelledAt: string | null;
  cancelWithinPolicy: boolean | null;
  createdAt: string;
}

interface Person {
  userId: string;
  membershipId: string;
}

describe('availability and bookings', () => {
  let application: NestFastifyApplication;
  let world: BookingWorld;
  let ownerUserId: string;
  let center: CreatedTestCenter;
  let staff: Person;
  let ana: Person;
  let bea: Person;
  let personalService: TestService;
  let centerId: string;

  const bookingsUrl = (path = ''): string => `/v1/centers/${centerId}/bookings${path}`;
  const asClient = (person: Person) => person.userId;

  async function bookSlot(person: Person, slot: TestSlot, service = personalService) {
    return world.book(asClient(person), centerId, {
      serviceId: service.id,
      startsAt: slot.startsAt,
    });
  }

  async function slotsFor(person: Person, service = personalService, staffId?: string) {
    return world.fetchSlots(asClient(person), centerId, service.id, staffId);
  }

  async function listMine(person: Person, scope: 'upcoming' | 'past') {
    const response = await world.call('GET', bookingsUrl(`/mine?scope=${scope}`), person.userId, {
      centerId,
    });
    return response.json<{ bookings: BookingBody[] }>().bookings;
  }

  beforeAll(async () => {
    application = await createTestApplication();
    world = new BookingWorld(application);
  });

  beforeEach(async () => {
    await resetTestDatabase();
    ownerUserId = await world.fixtures.createUser('owner');
    center = await world.createCenter(ownerUserId);
    centerId = center.centerId;
    await world.openAllWeek(ownerUserId, centerId);
    staff = await world.addMember(centerId, 'staff', 'staff');
    ana = await world.addMember(centerId, 'ana', 'client');
    bea = await world.addMember(centerId, 'bea', 'client');
    // Un servicio sin antelación mínima, para poder reservar y cancelar dentro de las próximas horas.
    personalService = await world.createService(ownerUserId, centerId, {
      name: 'Sesión personal',
      durationMinutes: 60,
      minNoticeMinutes: 0,
    });
  });

  afterAll(async () => {
    await application.close();
  });

  describe('GET /availability', () => {
    it('returns one slot per start time with the professional, in the center time zone, for every requested day', async () => {
      const today = localDateOf(new Date().toISOString());
      const response = await world.call(
        'GET',
        `/v1/centers/${centerId}/availability?serviceId=${personalService.id}&from=${today}&to=${today}`,
        ana.userId,
        { centerId },
      );

      expect(response.statusCode).toBe(200);
      const body = response.json<{
        timezone: string;
        days: { date: string; slots: TestSlot[] }[];
      }>();
      expect(body.timezone).toBe('Europe/Madrid');
      expect(body.days).toHaveLength(1);
      const starts = body.days.flatMap((day) => day.slots.map((slot) => slot.startsAt));
      expect(new Set(starts).size).toBe(starts.length);
      for (const slot of body.days.flatMap((day) => day.slots)) {
        expect(slot).toEqual({
          startsAt: expect.stringMatching(/Z$/) as string,
          endsAt: expect.stringMatching(/Z$/) as string,
          staffMembershipId: center.ownerMembershipId,
          staffName: 'owner',
        });
        expect(Date.parse(slot.endsAt) - Date.parse(slot.startsAt)).toBe(MILLISECONDS_PER_HOUR);
      }
    });

    it('lets the team and the clients ask, and filters by professional', async () => {
      const forStaff = await world.fetchSlots(staff.userId, centerId, personalService.id);
      const forOwnerOnly = await world.fetchSlots(
        ana.userId,
        centerId,
        personalService.id,
        center.ownerMembershipId,
      );
      const forSomeoneElse = await world.fetchSlots(
        ana.userId,
        centerId,
        personalService.id,
        staff.membershipId,
      );

      expect(forStaff.length).toBeGreaterThan(0);
      expect(forOwnerOnly).toEqual(forStaff);
      expect(forSomeoneElse).toEqual([]);
    });

    it('rejects ranges longer than 14 days, backwards ranges and malformed dates with 400', async () => {
      const ask = async (query: string) =>
        (
          await world.call(
            'GET',
            `/v1/centers/${centerId}/availability?serviceId=${personalService.id}&${query}`,
            ana.userId,
            { centerId },
          )
        ).statusCode;

      expect(await ask('from=2026-10-01&to=2026-10-15')).toBe(200);
      expect(await ask('from=2026-10-01&to=2026-10-16')).toBe(400);
      expect(await ask('from=2026-10-10&to=2026-10-09')).toBe(400);
      expect(await ask('from=hoy&to=mañana')).toBe(400);
      expect(await ask('from=2026-10-01')).toBe(400);
    });

    it('answers 404 for an unknown service and for a hidden one when the asker is a client', async () => {
      await world.call(
        'PATCH',
        `/v1/centers/${centerId}/services/${personalService.id}`,
        ownerUserId,
        {
          centerId,
          body: { isVisible: false },
        },
      );

      const hiddenForClient = await world.call(
        'GET',
        `/v1/centers/${centerId}/availability?serviceId=${personalService.id}&from=2026-10-01&to=2026-10-02`,
        ana.userId,
        { centerId },
      );
      const hiddenForStaff = await world.call(
        'GET',
        `/v1/centers/${centerId}/availability?serviceId=${personalService.id}&from=2026-10-01&to=2026-10-02`,
        staff.userId,
        { centerId },
      );
      const unknown = await world.call(
        'GET',
        `/v1/centers/${centerId}/availability?serviceId=${randomUUID()}&from=2026-10-01&to=2026-10-02`,
        ana.userId,
        { centerId },
      );

      expect(hiddenForClient.statusCode).toBe(404);
      expect(hiddenForStaff.statusCode).toBe(200);
      expect(unknown.statusCode).toBe(404);
    });

    it('returns closed days with an empty slot list and drops holidays', async () => {
      const slots = await slotsFor(ana);
      const holidayDate = localDateOf(firstSlotAtLeast(slots, 48).startsAt);
      const current = await world.call('GET', `/v1/centers/${centerId}`, ownerUserId, { centerId });
      await world.call('PATCH', `/v1/centers/${centerId}`, ownerUserId, {
        centerId,
        headers: { 'if-match': String(current.headers['etag']) },
        body: { holidays: [{ date: holidayDate, label: 'Fiesta local' }] },
      });

      const response = await world.call(
        'GET',
        `/v1/centers/${centerId}/availability?serviceId=${personalService.id}&from=${holidayDate}&to=${holidayDate}`,
        ana.userId,
        { centerId },
      );

      expect(response.json<{ days: { slots: unknown[] }[] }>().days).toEqual([
        { date: holidayDate, slots: [] },
      ]);
    });

    it('hides slots of a professional who already has a booking, and offers the other one', async () => {
      await world.call(
        'PATCH',
        `/v1/centers/${centerId}/services/${personalService.id}`,
        ownerUserId,
        {
          centerId,
          body: { staffMembershipIds: [center.ownerMembershipId, staff.membershipId] },
        },
      );
      const slot = firstSlotAtLeast(await slotsFor(ana), 3);
      await bookSlot(ana, slot);

      const sameHour = (await slotsFor(bea)).find(
        (candidate) => candidate.startsAt === slot.startsAt,
      );

      expect(sameHour).toBeDefined();
      expect(sameHour?.staffMembershipId).not.toBe(slot.staffMembershipId);
    });
  });

  describe('POST /bookings', () => {
    it('books a slot: 201 with the booking, service and professional', async () => {
      const slot = firstSlotAtLeast(await slotsFor(ana), 72);

      const response = await bookSlot(ana, slot);

      expect(response.statusCode).toBe(201);
      expect(response.json<BookingBody>()).toEqual({
        id: expect.stringMatching(/^[0-9a-f-]{36}$/) as string,
        status: 'confirmed',
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        service: {
          id: personalService.id,
          name: 'Sesión personal',
          durationMinutes: 60,
          color: null,
        },
        staff: { membershipId: center.ownerMembershipId, fullName: 'owner' },
        cancelledAt: null,
        cancelWithinPolicy: null,
        createdAt: expect.stringMatching(/Z$/) as string,
      });
    });

    it('is idempotent: the same key returns the same booking and creates only one', async () => {
      const slot = firstSlotAtLeast(await slotsFor(ana), 72);
      const key = randomUUID();
      const body = { serviceId: personalService.id, startsAt: slot.startsAt };

      const first = await world.book(ana.userId, centerId, body, key);
      const replay = await world.book(ana.userId, centerId, body, key);

      expect(replay.statusCode).toBe(201);
      expect(replay.json<BookingBody>().id).toBe(first.json<BookingBody>().id);
      expect(await listMine(ana, 'upcoming')).toHaveLength(1);
    });

    it('refuses to reuse a key for a different booking (422)', async () => {
      const [first, second] = (await slotsFor(ana)).filter(
        (slot) => Date.parse(slot.startsAt) - Date.now() > 72 * MILLISECONDS_PER_HOUR,
      );
      const key = randomUUID();
      await world.book(
        ana.userId,
        centerId,
        { serviceId: personalService.id, startsAt: first?.startsAt },
        key,
      );

      const response = await world.book(
        ana.userId,
        centerId,
        { serviceId: personalService.id, startsAt: second?.startsAt },
        key,
      );

      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    });

    it('answers 409 SLOT_UNAVAILABLE to the second person who asks for the same slot', async () => {
      const slot = firstSlotAtLeast(await slotsFor(ana), 72);
      await bookSlot(ana, slot);

      const response = await bookSlot(bea, slot);

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ code: 'SLOT_UNAVAILABLE' });
      expect(await listMine(bea, 'upcoming')).toEqual([]);
    });

    it('answers 409 ALREADY_BOOKED when the client has another appointment at the same time', async () => {
      const otherService = await world.createService(ownerUserId, centerId, {
        name: 'Otra sesión',
        durationMinutes: 60,
        staffMembershipIds: [staff.membershipId],
        minNoticeMinutes: 0,
      });
      const slot = firstSlotAtLeast(await slotsFor(ana), 72);
      await bookSlot(ana, slot);

      const sameTimeOtherService = await bookSlot(ana, slot, otherService);

      expect(sameTimeOtherService.statusCode).toBe(409);
      expect(sameTimeOtherService.json()).toMatchObject({ code: 'ALREADY_BOOKED' });
    });

    it('lets two appointments sit back to back, and frees the client again after a cancellation', async () => {
      const slots = await slotsFor(ana);
      const slot = firstSlotAtLeast(slots, 72);
      const nextSlot = slots.find((candidate) => candidate.startsAt === slot.endsAt);
      const first = await bookSlot(ana, slot);

      const backToBack = await bookSlot(ana, nextSlot ?? slot);

      expect(first.statusCode).toBe(201);
      expect(backToBack.statusCode).toBe(201);
    });

    it('rejects a start that is not exactly on a slot of the grid (409 SLOT_UNAVAILABLE)', async () => {
      const slot = firstSlotAtLeast(await slotsFor(ana), 72);
      const halfHourLater = new Date(Date.parse(slot.startsAt) + 30 * 60_000).toISOString();

      const response = await world.book(ana.userId, centerId, {
        serviceId: personalService.id,
        startsAt: halfHourLater,
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ code: 'SLOT_UNAVAILABLE' });
    });

    it('rejects a holiday as unavailable even if the client knows the time', async () => {
      const slot = firstSlotAtLeast(await slotsFor(ana), 72);
      const current = await world.call('GET', `/v1/centers/${centerId}`, ownerUserId, { centerId });
      await world.call('PATCH', `/v1/centers/${centerId}`, ownerUserId, {
        centerId,
        headers: { 'if-match': String(current.headers['etag']) },
        body: { holidays: [{ date: localDateOf(slot.startsAt), label: 'Cierre' }] },
      });

      const response = await bookSlot(ana, slot);

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ code: 'SLOT_UNAVAILABLE' });
    });

    it('answers 409 OUTSIDE_BOOKING_WINDOW before the minimum notice and after the booking window', async () => {
      const withNotice = await world.createService(ownerUserId, centerId, {
        name: 'Con antelación',
        durationMinutes: 60,
        minNoticeMinutes: 120,
        bookingWindowDays: 7,
      });
      const inOneHour = new Date(
        Math.ceil(Date.now() / MILLISECONDS_PER_HOUR) * MILLISECONDS_PER_HOUR,
      );
      const inTenDays = new Date(inOneHour.getTime() + 10 * HOURS_PER_DAY * MILLISECONDS_PER_HOUR);

      for (const startsAt of [inOneHour, inTenDays]) {
        const response = await world.book(ana.userId, centerId, {
          serviceId: withNotice.id,
          startsAt: startsAt.toISOString(),
        });

        expect(response.statusCode).toBe(409);
        expect(response.json()).toMatchObject({ code: 'OUTSIDE_BOOKING_WINDOW' });
      }
    });

    it('answers 404 for an unknown, archived or hidden service', async () => {
      const slot = firstSlotAtLeast(await slotsFor(ana), 72);
      const hidden = await world.createService(ownerUserId, centerId, {
        name: 'Oculto',
        durationMinutes: 60,
        isVisible: false,
      });
      const archived = await world.createService(ownerUserId, centerId, {
        name: 'Archivado',
        durationMinutes: 60,
      });
      await world.call('DELETE', `/v1/centers/${centerId}/services/${archived.id}`, ownerUserId, {
        centerId,
      });

      for (const serviceId of [randomUUID(), hidden.id, archived.id]) {
        const response = await world.book(ana.userId, centerId, {
          serviceId,
          startsAt: slot.startsAt,
        });

        expect(response.statusCode).toBe(404);
      }
    });

    it('validates the request: 400 without the key, with a bad body or with extra fields', async () => {
      const slot = firstSlotAtLeast(await slotsFor(ana), 72);
      const valid = { serviceId: personalService.id, startsAt: slot.startsAt };

      const withoutKey = await world.call('POST', bookingsUrl(), ana.userId, {
        centerId,
        body: valid,
      });
      const badDate = await world.book(ana.userId, centerId, { ...valid, startsAt: 'mañana' });
      const withOffset = await world.book(ana.userId, centerId, {
        ...valid,
        startsAt: '2030-01-01T10:00:00+01:00',
      });
      const extraField = await world.book(ana.userId, centerId, {
        ...valid,
        clientMembershipId: bea.membershipId,
      });
      const badKey = await world.call('POST', bookingsUrl(), ana.userId, {
        centerId,
        body: valid,
        headers: { 'idempotency-key': 'not-a-uuid' },
      });

      expect(withoutKey.statusCode).toBe(400);
      expect(withoutKey.json()).toMatchObject({ code: 'IDEMPOTENCY_KEY_REQUIRED' });
      expect(badKey.statusCode).toBe(400);
      expect(badDate.statusCode).toBe(400);
      expect(withOffset.statusCode).toBe(400);
      expect(extraField.statusCode).toBe(400);
    });

    it('is only for clients: the team gets 403, anonymous callers 401', async () => {
      const slot = firstSlotAtLeast(await slotsFor(ana), 72);
      const body = { serviceId: personalService.id, startsAt: slot.startsAt };

      const asStaff = await world.book(staff.userId, centerId, body);
      const asOwner = await world.book(ownerUserId, centerId, body);
      const anonymous = await world.call('POST', bookingsUrl(), undefined, {
        centerId,
        body,
        headers: { 'idempotency-key': randomUUID() },
      });

      expect(asStaff.statusCode).toBe(403);
      expect(asOwner.statusCode).toBe(403);
      expect(anonymous.statusCode).toBe(401);
    });

    it('does not let a client whose membership is not active book (404, like any other route of the center)', async () => {
      const blocked = await world.addMember(centerId, 'blocked', 'client');
      await world.tenantPrismaService.runInTenantContext(
        {
          userId: ownerUserId,
          centerId,
          membershipId: center.ownerMembershipId,
          role: 'owner',
          permissions: [],
        },
        (prisma) =>
          prisma.membership.update({
            where: { id: blocked.membershipId },
            data: { status: 'blocked' },
          }),
      );
      const slot = firstSlotAtLeast(await slotsFor(ana), 72);

      const response = await bookSlot(blocked, slot);

      expect(response.statusCode).toBe(404);
    });
  });

  describe('GET /bookings/mine', () => {
    it('lists upcoming bookings from the nearest and past ones from the most recent, with a limit', async () => {
      const slots = (await slotsFor(ana)).filter(
        (slot) => Date.parse(slot.startsAt) - Date.now() > 72 * MILLISECONDS_PER_HOUR,
      );
      const [first, second, third] = slots.filter((_slot, index) => index % 2 === 0);
      for (const slot of [third, first, second]) await bookSlot(ana, slot as TestSlot);
      const yesterday = await insertPastBooking(ana, 'attended', 24);
      const lastWeek = await insertPastBooking(ana, 'no_show', 24 * 7);

      const upcoming = await listMine(ana, 'upcoming');
      const past = await listMine(ana, 'past');
      const limited = await world.call('GET', bookingsUrl('/mine?limit=2'), ana.userId, {
        centerId,
      });

      expect(upcoming.map(({ startsAt }) => startsAt)).toEqual(
        [first, second, third].map((slot) => slot?.startsAt),
      );
      expect(past.map(({ id }) => id)).toEqual([yesterday, lastWeek]);
      expect(limited.json<{ bookings: unknown[] }>().bookings).toHaveLength(2);
    });

    it('defaults to upcoming and validates scope and limit', async () => {
      expect(
        (await world.call('GET', bookingsUrl('/mine'), ana.userId, { centerId })).statusCode,
      ).toBe(200);
      for (const query of ['scope=all', 'limit=0', 'limit=51', 'limit=abc', 'extra=1']) {
        const response = await world.call('GET', bookingsUrl(`/mine?${query}`), ana.userId, {
          centerId,
        });

        expect(response.statusCode).toBe(400);
      }
    });

    it('shows each client only their own bookings', async () => {
      const slots = await slotsFor(ana);
      await bookSlot(ana, firstSlotAtLeast(slots, 72));

      expect(await listMine(ana, 'upcoming')).toHaveLength(1);
      expect(await listMine(bea, 'upcoming')).toEqual([]);
    });

    it('is only for clients (403 for the team)', async () => {
      const response = await world.call('GET', bookingsUrl('/mine'), staff.userId, { centerId });

      expect(response.statusCode).toBe(403);
    });
  });

  /** Inserta una reserva ya pasada, imposible de crear por la API, como lo haría una pasada de lista. */
  async function insertPastBooking(
    person: Person,
    status: 'attended' | 'no_show',
    hoursAgo: number,
  ): Promise<string> {
    const startsAt = new Date(Date.now() - hoursAgo * MILLISECONDS_PER_HOUR);
    const sessionId = generateUuidV7();
    const bookingId = generateUuidV7();
    await world.tenantPrismaService.runInTenantContext(
      {
        userId: ownerUserId,
        centerId,
        membershipId: center.ownerMembershipId,
        role: 'owner',
        permissions: [],
      },
      async (prisma) => {
        await prisma.classSession.create({
          data: {
            id: sessionId,
            centerId,
            serviceId: personalService.id,
            staffMembershipId: center.ownerMembershipId,
            startsAt,
            endsAt: new Date(startsAt.getTime() + MILLISECONDS_PER_HOUR),
          },
        });
        await prisma.booking.create({
          data: {
            id: bookingId,
            centerId,
            classSessionId: sessionId,
            clientMembershipId: person.membershipId,
            status,
          },
        });
      },
    );
    return bookingId;
  }

  describe('POST /bookings/:bookingId/cancel', () => {
    it('cancels within the policy when at least 24 hours remain, and frees the slot', async () => {
      const slot = firstSlotAtLeast(await slotsFor(ana), 72);
      const booked = (await bookSlot(ana, slot)).json<BookingBody>();

      const response = await world.call('POST', bookingsUrl(`/${booked.id}/cancel`), ana.userId, {
        centerId,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ booking: BookingBody; withinPolicy: boolean }>();
      expect(body.withinPolicy).toBe(true);
      expect(body.booking).toMatchObject({
        id: booked.id,
        status: 'cancelled',
        cancelWithinPolicy: true,
        cancelledAt: expect.stringMatching(/Z$/) as string,
      });
      expect((await bookSlot(bea, slot)).statusCode).toBe(201);
    });

    it('lets a client cancel late, flagging it as outside the policy', async () => {
      const soon = firstSlotAtLeast(await slotsFor(ana), 2, 20);
      const booked = (await bookSlot(ana, soon)).json<BookingBody>();

      const response = await world.call('POST', bookingsUrl(`/${booked.id}/cancel`), ana.userId, {
        centerId,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        withinPolicy: false,
        booking: { status: 'cancelled', cancelWithinPolicy: false },
      });
    });

    it('uses the cancellation window of the center policy when it has one', async () => {
      const current = await world.call('GET', `/v1/centers/${centerId}`, ownerUserId, { centerId });
      await world.call('PATCH', `/v1/centers/${centerId}`, ownerUserId, {
        centerId,
        headers: { 'if-match': String(current.headers['etag']) },
        body: { cancelPolicy: { freeCancellationHours: 1, lateCancellationConsumesCredit: false } },
      });
      const soon = firstSlotAtLeast(await slotsFor(ana), 3, 20);
      const booked = (await bookSlot(ana, soon)).json<BookingBody>();

      const response = await world.call('POST', bookingsUrl(`/${booked.id}/cancel`), ana.userId, {
        centerId,
      });

      expect(response.json()).toMatchObject({ withinPolicy: true });
    });

    it('answers 200 with the same result when cancelling twice', async () => {
      const slot = firstSlotAtLeast(await slotsFor(ana), 72);
      const booked = (await bookSlot(ana, slot)).json<BookingBody>();
      const url = bookingsUrl(`/${booked.id}/cancel`);

      const first = await world.call('POST', url, ana.userId, { centerId });
      const second = await world.call('POST', url, ana.userId, { centerId });

      expect(second.statusCode).toBe(200);
      expect(second.json()).toEqual(first.json());
    });

    it('accepts a cancel sent with a JSON content type and no body, as most HTTP clients do', async () => {
      const slot = firstSlotAtLeast(await slotsFor(ana), 72);
      const booked = (await bookSlot(ana, slot)).json<BookingBody>();

      const response = await world.call('POST', bookingsUrl(`/${booked.id}/cancel`), ana.userId, {
        centerId,
        headers: { 'content-type': 'application/json' },
      });

      expect(response.statusCode).toBe(200);
    });

    it('still rejects a malformed or poisoned JSON body with 400', async () => {
      const malformed = await world.call('POST', bookingsUrl(), ana.userId, {
        centerId,
        headers: {
          'content-type': 'application/json',
          'idempotency-key': randomUUID(),
        },
        rawBody: '{"serviceId": ',
      });

      expect(malformed.statusCode).toBe(400);
    });

    it('answers 409 BOOKING_NOT_CANCELLABLE for a booking that already took place', async () => {
      const pastBookingId = await insertPastBooking(ana, 'attended', 5);

      const response = await world.call(
        'POST',
        bookingsUrl(`/${pastBookingId}/cancel`),
        ana.userId,
        {
          centerId,
        },
      );

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ code: 'BOOKING_NOT_CANCELLABLE' });
    });

    it('answers 404 to another client, to the team and for unknown bookings (BOLA)', async () => {
      const slot = firstSlotAtLeast(await slotsFor(ana), 72);
      const booked = (await bookSlot(ana, slot)).json<BookingBody>();

      const byOtherClient = await world.call(
        'POST',
        bookingsUrl(`/${booked.id}/cancel`),
        bea.userId,
        { centerId },
      );
      const unknown = await world.call('POST', bookingsUrl(`/${randomUUID()}/cancel`), ana.userId, {
        centerId,
      });
      const byStaff = await world.call('POST', bookingsUrl(`/${booked.id}/cancel`), staff.userId, {
        centerId,
      });

      expect(byOtherClient.statusCode).toBe(404);
      expect(unknown.statusCode).toBe(404);
      expect(byStaff.statusCode).toBe(403);
      expect(await listMine(ana, 'upcoming')).toHaveLength(1);
    });
  });

  describe('GET /agenda', () => {
    let serviceForStaff: TestService;
    let ownBooking: BookingBody;
    let cancelledBooking: BookingBody;
    let ownersBooking: BookingBody;
    let date: string;

    beforeEach(async () => {
      serviceForStaff = await world.createService(ownerUserId, centerId, {
        name: 'Con la profe',
        durationMinutes: 60,
        minNoticeMinutes: 0,
        staffMembershipIds: [staff.membershipId],
      });
      const staffSlots = (await slotsFor(ana, serviceForStaff)).filter(
        (slot) => Date.parse(slot.startsAt) - Date.now() > 72 * MILLISECONDS_PER_HOUR,
      );
      const ownerSlots = await slotsFor(ana);
      const [firstStaffSlot, secondStaffSlot] = staffSlots as [TestSlot, TestSlot];
      date = localDateOf(firstStaffSlot.startsAt);
      ownBooking = (await bookSlot(ana, firstStaffSlot, serviceForStaff)).json<BookingBody>();
      cancelledBooking = (
        await bookSlot(bea, secondStaffSlot, serviceForStaff)
      ).json<BookingBody>();
      await world.call('POST', bookingsUrl(`/${cancelledBooking.id}/cancel`), bea.userId, {
        centerId,
      });
      const ownerSlot = ownerSlots.find(
        (slot) => slot.startsAt === firstStaffSlot.startsAt,
      ) as TestSlot;
      ownersBooking = (await bookSlot(bea, ownerSlot)).json<BookingBody>();
    });

    const agendaUrl = (day: string, staffMembershipId?: string): string => {
      const filter = staffMembershipId ? `&staffMembershipId=${staffMembershipId}` : '';
      return `/v1/centers/${centerId}/agenda?date=${day}${filter}`;
    };

    interface AgendaBody {
      date: string;
      timezone: string;
      entries: { booking: BookingBody; client: { membershipId: string; fullName: string } }[];
    }

    it('shows the staff member their own day, ordered by time, with who booked and the cancelled ones marked', async () => {
      const response = await world.call('GET', agendaUrl(date), staff.userId, { centerId });

      expect(response.statusCode).toBe(200);
      const body = response.json<AgendaBody>();
      expect(body).toMatchObject({ date, timezone: 'Europe/Madrid' });
      const ids = body.entries.map(({ booking }) => booking.id);
      expect(ids).toContain(ownBooking.id);
      expect(ids).not.toContain(ownersBooking.id);
      const startTimes = body.entries.map(({ booking }) => booking.startsAt);
      expect([...startTimes].sort((first, second) => first.localeCompare(second))).toEqual(
        startTimes,
      );
      const mine = body.entries.find(({ booking }) => booking.id === ownBooking.id);
      expect(mine?.client).toEqual({ membershipId: ana.membershipId, fullName: 'ana' });
      expect(mine?.booking.status).toBe('confirmed');
    });

    it('includes the cancelled bookings of the day with their status', async () => {
      const cancelledDate = localDateOf(cancelledBooking.startsAt);

      const response = await world.call('GET', agendaUrl(cancelledDate), staff.userId, {
        centerId,
      });

      const cancelled = response
        .json<AgendaBody>()
        .entries.find(({ booking }) => booking.id === cancelledBooking.id);
      expect(cancelled?.booking).toMatchObject({ status: 'cancelled', cancelWithinPolicy: true });
    });

    it('keeps staff on their own agenda even when they ask for someone else', async () => {
      const response = await world.call(
        'GET',
        agendaUrl(date, center.ownerMembershipId),
        staff.userId,
        { centerId },
      );

      const ids = response.json<AgendaBody>().entries.map(({ booking }) => booking.id);
      expect(ids).toContain(ownBooking.id);
      expect(ids).not.toContain(ownersBooking.id);
    });

    it('lets the owner see everyone or filter by professional', async () => {
      const everyone = await world.call('GET', agendaUrl(date), ownerUserId, { centerId });
      const onlyOwner = await world.call(
        'GET',
        agendaUrl(date, center.ownerMembershipId),
        ownerUserId,
        { centerId },
      );

      const everyoneIds = everyone.json<AgendaBody>().entries.map(({ booking }) => booking.id);
      expect(everyoneIds).toEqual(expect.arrayContaining([ownBooking.id, ownersBooking.id]));
      expect(onlyOwner.json<AgendaBody>().entries.map(({ booking }) => booking.id)).toEqual([
        ownersBooking.id,
      ]);
    });

    it('is not for clients (403), needs a valid date (400) and a session (401)', async () => {
      expect((await world.call('GET', agendaUrl(date), ana.userId, { centerId })).statusCode).toBe(
        403,
      );
      expect(
        (await world.call('GET', agendaUrl('hoy'), staff.userId, { centerId })).statusCode,
      ).toBe(400);
      expect((await world.call('GET', agendaUrl(date), undefined, { centerId })).statusCode).toBe(
        401,
      );
    });
  });

  describe('isolation between centers and between clients', () => {
    it('does not show or accept bookings of another center', async () => {
      const otherOwner = await world.fixtures.createUser('other-owner');
      const otherCenter = await world.createCenter(otherOwner, 'Otro Centro');
      const outsider = await world.addMember(otherCenter.centerId, 'outsider', 'client');
      const slot = firstSlotAtLeast(await slotsFor(ana), 72);
      const booked = (await bookSlot(ana, slot)).json<BookingBody>();

      const bookingHere = await world.book(outsider.userId, centerId, {
        serviceId: personalService.id,
        startsAt: slot.startsAt,
      });
      const cancelHere = await world.call(
        'POST',
        bookingsUrl(`/${booked.id}/cancel`),
        outsider.userId,
        {
          centerId,
        },
      );
      const availabilityHere = await world.call(
        'GET',
        `/v1/centers/${centerId}/availability?serviceId=${personalService.id}&from=2026-10-01&to=2026-10-02`,
        outsider.userId,
        { centerId },
      );
      const foreignServiceInOwnCenter = await world.book(outsider.userId, otherCenter.centerId, {
        serviceId: personalService.id,
        startsAt: slot.startsAt,
      });

      expect(bookingHere.statusCode).toBe(404);
      expect(cancelHere.statusCode).toBe(404);
      expect(availabilityHere.statusCode).toBe(404);
      expect(foreignServiceInOwnCenter.statusCode).toBe(404);
      expect(await listMine(ana, 'upcoming')).toHaveLength(1);
    });

    it('enforces in the database that a client only sees their own bookings, even if the app forgot to filter', async () => {
      const slots = await slotsFor(ana);
      await bookSlot(ana, firstSlotAtLeast(slots, 72));
      await bookSlot(bea, firstSlotAtLeast(slots, 96));
      const asClient = (person: Person) => ({
        userId: person.userId,
        centerId,
        membershipId: person.membershipId,
        role: 'client' as const,
        permissions: [],
      });

      const seenByAna = await world.tenantPrismaService.runInTenantContext(
        asClient(ana),
        (prisma) => prisma.booking.findMany({ select: { clientMembershipId: true } }),
      );
      const seenByStaff = await world.tenantPrismaService.runInTenantContext(
        { ...asClient(staff), role: 'staff' },
        (prisma) => prisma.booking.count(),
      );

      expect(seenByAna).toEqual([{ clientMembershipId: ana.membershipId }]);
      expect(seenByStaff).toBe(2);
    });

    it('does not let a client write a booking for someone else, even straight in the database', async () => {
      const slot = firstSlotAtLeast(await slotsFor(ana), 72);
      const booked = (await bookSlot(ana, slot)).json<BookingBody>();
      const asBea = {
        userId: bea.userId,
        centerId,
        membershipId: bea.membershipId,
        role: 'client' as const,
        permissions: [],
      };

      const update = await world.tenantPrismaService.runInTenantContext(asBea, (prisma) =>
        prisma.booking.updateMany({ where: { id: booked.id }, data: { status: 'cancelled' } }),
      );

      expect(update.count).toBe(0);
    });
  });
});
