import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { v7 as generateUuidV7 } from 'uuid';
import { BookingWorld, localDateOf, type CreatedTestCenter } from '../support/booking-world';
import { resetTestDatabase } from '../support/test-database';
import { createTestApplication } from './create-test-application';

const MILLISECONDS_PER_MINUTE = 60_000;
const MILLISECONDS_PER_DAY = 86_400_000;

interface SessionBookingBody {
  id: string;
  status: string;
  startsAt: string;
  endsAt: string;
  startedAt: string | null;
  endedAt: string | null;
  actualDurationSeconds: number | null;
  staff: { membershipId: string; fullName: string };
}

interface RecordsBody {
  timezone: string;
  records: {
    booking: SessionBookingBody;
    client: { membershipId: string; fullName: string };
    staff: { membershipId: string; fullName: string };
    plannedDurationSeconds: number;
    actualDurationSeconds: number | null;
    isOpen: boolean;
    notes: string | null;
  }[];
  totals: {
    staffMembershipId: string;
    staffName: string;
    classCount: number;
    plannedSeconds: number;
    actualSeconds: number;
    openCount: number;
  }[];
}

interface Person {
  userId: string;
  membershipId: string;
}

interface NewBooking {
  readonly clientMembershipId: string;
  readonly staffMembershipId: string;
  /** Minutos desde ahora hasta el inicio (negativo: ya empezó). */
  readonly startsInMinutes: number;
  readonly durationMinutes?: number;
  readonly status?: 'confirmed' | 'cancelled';
}

describe('class session records', () => {
  let application: NestFastifyApplication;
  let world: BookingWorld;
  let ownerUserId: string;
  let center: CreatedTestCenter;
  let centerId: string;
  let serviceId: string;
  let staff: Person;
  let otherStaff: Person;
  let admin: Person;
  let ana: Person;

  const bookingUrl = (bookingId: string, action: 'start' | 'end'): string =>
    `/v1/centers/${centerId}/bookings/${bookingId}/${action}`;
  const recordsUrl = (query: string): string => `/v1/centers/${centerId}/session-records?${query}`;
  const ownerActor = () =>
    ({
      userId: ownerUserId,
      centerId,
      membershipId: center.ownerMembershipId,
      role: 'owner',
      permissions: [],
    }) as const;

  /** Una reserva a la hora que se quiera, imposible de crear por la API (huecos pasados o muy próximos). */
  async function insertBooking(newBooking: NewBooking): Promise<string> {
    const startsAt = new Date(Date.now() + newBooking.startsInMinutes * MILLISECONDS_PER_MINUTE);
    const endsAt = new Date(
      startsAt.getTime() + (newBooking.durationMinutes ?? 60) * MILLISECONDS_PER_MINUTE,
    );
    const sessionId = generateUuidV7();
    const bookingId = generateUuidV7();
    await world.tenantPrismaService.runInTenantContext(ownerActor(), async (prisma) => {
      await prisma.classSession.create({
        data: {
          id: sessionId,
          centerId,
          serviceId,
          staffMembershipId: newBooking.staffMembershipId,
          startsAt,
          endsAt,
        },
      });
      await prisma.booking.create({
        data: {
          id: bookingId,
          centerId,
          classSessionId: sessionId,
          clientMembershipId: newBooking.clientMembershipId,
          status: newBooking.status ?? 'confirmed',
        },
      });
    });
    return bookingId;
  }

  async function startAs(person: Person, bookingId: string, isMfaVerified = true) {
    return world.call('POST', bookingUrl(bookingId, 'start'), person.userId, {
      centerId,
      isMfaVerified,
    });
  }

  async function endAs(person: Person, bookingId: string, body?: object) {
    return world.call('POST', bookingUrl(bookingId, 'end'), person.userId, {
      centerId,
      ...(body && { body }),
    });
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
    staff = await world.addMember(centerId, 'staff', 'staff');
    otherStaff = await world.addMember(centerId, 'otherstaff', 'staff');
    admin = await world.addMember(centerId, 'admin', 'admin');
    ana = await world.addMember(centerId, 'ana', 'client');
    serviceId = (
      await world.createService(ownerUserId, centerId, {
        name: 'Sesión personal',
        durationMinutes: 60,
      })
    ).id;
  });

  afterAll(async () => {
    await application.close();
  });

  describe('POST /bookings/:bookingId/start and /end', () => {
    it('lets the assigned professional run the whole class and shows the times to the client', async () => {
      const bookingId = await insertBooking({
        clientMembershipId: ana.membershipId,
        staffMembershipId: staff.membershipId,
        startsInMinutes: 5,
      });

      const started = await startAs(staff, bookingId);

      expect(started.statusCode).toBe(200);
      expect(started.json<SessionBookingBody>()).toMatchObject({
        id: bookingId,
        status: 'confirmed',
        startedAt: expect.stringMatching(/Z$/) as string,
        endedAt: null,
        actualDurationSeconds: null,
      });
      const clientView = await world.call(
        'GET',
        `/v1/centers/${centerId}/bookings/mine?scope=upcoming`,
        ana.userId,
        { centerId },
      );
      expect(clientView.json<{ bookings: SessionBookingBody[] }>().bookings[0]).toMatchObject({
        id: bookingId,
        startedAt: started.json<SessionBookingBody>().startedAt,
      });

      const ended = await endAs(staff, bookingId, { notes: 'Trabajamos el hombro' });

      expect(ended.statusCode).toBe(200);
      const endedBody = ended.json<SessionBookingBody>();
      expect(endedBody).toMatchObject({
        status: 'attended',
        startedAt: started.json<SessionBookingBody>().startedAt,
        endedAt: expect.stringMatching(/Z$/) as string,
      });
      const elapsedSeconds = Math.floor(
        (Date.parse(endedBody.endedAt ?? '') - Date.parse(endedBody.startedAt ?? '')) / 1000,
      );
      expect(endedBody.actualDurationSeconds).toBe(elapsedSeconds);
    });

    it('is idempotent: starting or ending again answers 200 with the same times and changes nothing', async () => {
      const bookingId = await insertBooking({
        clientMembershipId: ana.membershipId,
        staffMembershipId: staff.membershipId,
        startsInMinutes: 0,
      });
      const firstStart = (await startAs(staff, bookingId)).json<SessionBookingBody>();
      const secondStart = await startAs(staff, bookingId);
      const firstEnd = (
        await endAs(staff, bookingId, { notes: 'Primera' })
      ).json<SessionBookingBody>();
      const secondEnd = await endAs(staff, bookingId, { notes: 'Segunda' });
      const startAfterEnd = await startAs(staff, bookingId);

      expect(secondStart.json()).toEqual(firstStart);
      expect(secondEnd.statusCode).toBe(200);
      expect(secondEnd.json()).toEqual(firstEnd);
      expect(startAfterEnd.json()).toEqual(firstEnd);
      const records = await world.call('GET', recordsUrl(todayRange()), ownerUserId, { centerId });
      expect(records.json<RecordsBody>().records[0]?.notes).toBe('Primera');
    });

    it.each([
      ['more than 15 minutes before it begins', 16, 60, 'confirmed'],
      ['after it already finished', -90, 60, 'confirmed'],
      ['when the booking was cancelled', 5, 60, 'cancelled'],
    ] as const)(
      'answers 409 BOOKING_NOT_STARTABLE %s',
      async (_description, inMinutes, duration, status) => {
        const bookingId = await insertBooking({
          clientMembershipId: ana.membershipId,
          staffMembershipId: staff.membershipId,
          startsInMinutes: inMinutes,
          durationMinutes: duration,
          status,
        });

        const response = await startAs(staff, bookingId);

        expect(response.statusCode).toBe(409);
        expect(response.json()).toMatchObject({ code: 'BOOKING_NOT_STARTABLE' });
      },
    );

    it('opens the window 15 minutes ahead and keeps it open until the class ends', async () => {
      const early = await insertBooking({
        clientMembershipId: ana.membershipId,
        staffMembershipId: staff.membershipId,
        startsInMinutes: 14,
      });
      const late = await insertBooking({
        clientMembershipId: ana.membershipId,
        staffMembershipId: otherStaff.membershipId,
        startsInMinutes: -50,
      });

      expect((await startAs(staff, early)).statusCode).toBe(200);
      expect((await startAs(otherStaff, late)).statusCode).toBe(200);
    });

    it('answers 409 SESSION_NOT_STARTED when ending a class that was never started', async () => {
      const bookingId = await insertBooking({
        clientMembershipId: ana.membershipId,
        staffMembershipId: staff.membershipId,
        startsInMinutes: 0,
      });

      const response = await endAs(staff, bookingId);

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ code: 'SESSION_NOT_STARTED' });
    });

    it('lets the class be closed long after it was due, with no upper time limit', async () => {
      const bookingId = await insertBooking({
        clientMembershipId: ana.membershipId,
        staffMembershipId: staff.membershipId,
        startsInMinutes: -600,
        durationMinutes: 660,
      });
      await startAs(staff, bookingId);
      await world.tenantPrismaService.runInTenantContext(ownerActor(), (prisma) =>
        prisma.booking.update({
          where: { id: bookingId },
          data: { startedAt: new Date(Date.now() - 300 * MILLISECONDS_PER_MINUTE) },
        }),
      );

      const ended = await endAs(staff, bookingId);

      expect(ended.statusCode).toBe(200);
      expect(ended.json<SessionBookingBody>().actualDurationSeconds).toBeGreaterThanOrEqual(
        299 * 60,
      );
    });

    it('refuses a second open class for the same professional until the first one is closed', async () => {
      const first = await insertBooking({
        clientMembershipId: ana.membershipId,
        staffMembershipId: staff.membershipId,
        startsInMinutes: -50,
      });
      const second = await insertBooking({
        clientMembershipId: ana.membershipId,
        staffMembershipId: staff.membershipId,
        startsInMinutes: 10,
      });
      await startAs(staff, first);

      const whileOpen = await startAs(staff, second);
      await endAs(staff, first);
      const afterClosing = await startAs(staff, second);

      expect(whileOpen.statusCode).toBe(409);
      expect(whileOpen.json()).toMatchObject({ code: 'SESSION_ALREADY_OPEN' });
      expect(afterClosing.statusCode).toBe(200);
    });

    it('lets only one of two simultaneous starts of the same professional open', async () => {
      const first = await insertBooking({
        clientMembershipId: ana.membershipId,
        staffMembershipId: staff.membershipId,
        startsInMinutes: -50,
      });
      const second = await insertBooking({
        clientMembershipId: ana.membershipId,
        staffMembershipId: staff.membershipId,
        startsInMinutes: 10,
      });

      const responses = await Promise.all([startAs(staff, first), startAs(staff, second)]);

      expect(
        responses.map(({ statusCode }) => statusCode).sort((first, second) => first - second),
      ).toEqual([200, 409]);
      const open = await world.tenantPrismaService.runInTenantContext(ownerActor(), (prisma) =>
        prisma.booking.count({ where: { startedAt: { not: null }, endedAt: null } }),
      );
      expect(open).toBe(1);
    });

    it('keeps two professionals independent: both can have a class open at the same time', async () => {
      const mine = await insertBooking({
        clientMembershipId: ana.membershipId,
        staffMembershipId: staff.membershipId,
        startsInMinutes: 0,
      });
      const theirs = await insertBooking({
        clientMembershipId: ana.membershipId,
        staffMembershipId: otherStaff.membershipId,
        startsInMinutes: 0,
      });

      const responses = await Promise.all([startAs(staff, mine), startAs(otherStaff, theirs)]);

      expect(responses.map(({ statusCode }) => statusCode)).toEqual([200, 200]);
    });

    it('stops the client from cancelling a class that has already been started', async () => {
      const bookingId = await insertBooking({
        clientMembershipId: ana.membershipId,
        staffMembershipId: staff.membershipId,
        startsInMinutes: 5,
      });
      await startAs(staff, bookingId);

      const response = await world.call(
        'POST',
        `/v1/centers/${centerId}/bookings/${bookingId}/cancel`,
        ana.userId,
        { centerId },
      );

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ code: 'BOOKING_NOT_CANCELLABLE' });
    });

    it('validates the notes and rejects unknown body fields', async () => {
      const bookingId = await insertBooking({
        clientMembershipId: ana.membershipId,
        staffMembershipId: staff.membershipId,
        startsInMinutes: 0,
      });
      await startAs(staff, bookingId);

      const tooLong = await endAs(staff, bookingId, { notes: 'x'.repeat(501) });
      const unknownField = await endAs(staff, bookingId, { status: 'no_show' });
      const maximum = await endAs(staff, bookingId, { notes: 'x'.repeat(500) });

      expect(tooLong.statusCode).toBe(400);
      expect(unknownField.statusCode).toBe(400);
      expect(maximum.statusCode).toBe(200);
    });
  });

  describe('who can start and end a class', () => {
    let bookingId: string;

    beforeEach(async () => {
      bookingId = await insertBooking({
        clientMembershipId: ana.membershipId,
        staffMembershipId: staff.membershipId,
        startsInMinutes: 0,
      });
    });

    it('answers 404 to another professional of the same center, without revealing the booking', async () => {
      const response = await startAs(otherStaff, bookingId);
      const ending = await endAs(otherStaff, bookingId);

      expect(response.statusCode).toBe(404);
      expect(ending.statusCode).toBe(404);
    });

    it('answers 404 to a professional of another center and to an unknown booking', async () => {
      const otherOwner = await world.fixtures.createUser('other-owner');
      const otherCenter = await world.createCenter(otherOwner, 'Otro Centro');
      const outsider = await world.addMember(otherCenter.centerId, 'outsider', 'staff');

      const inOurCenter = await world.call(
        'POST',
        bookingUrl(bookingId, 'start'),
        outsider.userId,
        {
          centerId,
        },
      );
      const inTheirCenter = await world.call(
        'POST',
        `/v1/centers/${otherCenter.centerId}/bookings/${bookingId}/start`,
        outsider.userId,
        { centerId: otherCenter.centerId },
      );
      const unknown = await startAs(staff, generateUuidV7());

      expect(inOurCenter.statusCode).toBe(404);
      expect(inTheirCenter.statusCode).toBe(404);
      expect(unknown.statusCode).toBe(404);
    });

    it('does not let a client start or end a class, nor an anonymous caller', async () => {
      const asClient = await startAs(ana, bookingId);
      const endingAsClient = await endAs(ana, bookingId);
      const anonymous = await world.call('POST', bookingUrl(bookingId, 'start'), undefined, {
        centerId,
      });

      expect(asClient.statusCode).toBe(403);
      expect(endingAsClient.statusCode).toBe(403);
      expect(anonymous.statusCode).toBe(401);
    });

    it('lets an admin start and end any class of the center, but only with a second factor', async () => {
      const withoutSecondFactor = await startAs(admin, bookingId, false);
      const started = await startAs(admin, bookingId);
      const ended = await endAs(admin, bookingId);

      expect(withoutSecondFactor.statusCode).toBe(403);
      expect(withoutSecondFactor.json()).toMatchObject({ code: 'MFA_REQUIRED' });
      expect(started.statusCode).toBe(200);
      expect(ended.statusCode).toBe(200);
      const stored = await world.tenantPrismaService.runInTenantContext(ownerActor(), (prisma) =>
        prisma.booking.findUniqueOrThrow({ where: { id: bookingId } }),
      );
      expect(stored.startedByMembershipId).toBe(admin.membershipId);
      expect(stored.endedByMembershipId).toBe(admin.membershipId);
    });

    it('rejects an end time before the start time at the database level', async () => {
      await startAs(staff, bookingId);

      await expect(
        world.tenantPrismaService.runInTenantContext(ownerActor(), (prisma) =>
          prisma.booking.update({
            where: { id: bookingId },
            data: { endedAt: new Date(Date.now() - MILLISECONDS_PER_DAY) },
          }),
        ),
      ).rejects.toThrow();
    });
  });

  function todayRange(): string {
    const yesterday = localDateOf(new Date(Date.now() - MILLISECONDS_PER_DAY).toISOString());
    const tomorrow = localDateOf(new Date(Date.now() + MILLISECONDS_PER_DAY).toISOString());
    return `from=${yesterday}&to=${tomorrow}`;
  }

  describe('GET /session-records', () => {
    it('lists started and unrecorded classes with real durations, notes and totals per professional', async () => {
      const closedByStaff = await insertBooking({
        clientMembershipId: ana.membershipId,
        staffMembershipId: staff.membershipId,
        startsInMinutes: -300,
      });
      const openByOther = await insertBooking({
        clientMembershipId: ana.membershipId,
        staffMembershipId: otherStaff.membershipId,
        startsInMinutes: -50,
      });
      const unrecorded = await insertBooking({
        clientMembershipId: ana.membershipId,
        staffMembershipId: staff.membershipId,
        startsInMinutes: -200,
      });
      await insertBooking({
        clientMembershipId: ana.membershipId,
        staffMembershipId: staff.membershipId,
        startsInMinutes: 120,
      });
      await insertBooking({
        clientMembershipId: ana.membershipId,
        staffMembershipId: staff.membershipId,
        startsInMinutes: -120,
        status: 'cancelled',
      });
      await world.tenantPrismaService.runInTenantContext(ownerActor(), (prisma) =>
        prisma.booking.update({
          where: { id: closedByStaff },
          data: {
            startedAt: new Date(Date.now() - 295 * MILLISECONDS_PER_MINUTE),
            startedByMembershipId: staff.membershipId,
          },
        }),
      );
      await startAs(otherStaff, openByOther);
      await endAs(staff, closedByStaff, { notes: 'Todo bien' });

      const response = await world.call('GET', recordsUrl(todayRange()), ownerUserId, { centerId });

      expect(response.statusCode).toBe(200);
      const body = response.json<RecordsBody>();
      expect(body.timezone).toBe('Europe/Madrid');
      expect(body.records.map(({ booking }) => booking.id)).toEqual([
        closedByStaff,
        unrecorded,
        openByOther,
      ]);
      const [closed, missing, open] = body.records;
      expect(closed).toMatchObject({
        isOpen: false,
        notes: 'Todo bien',
        plannedDurationSeconds: 3600,
        staff: { membershipId: staff.membershipId },
        client: { membershipId: ana.membershipId },
      });
      expect(closed?.actualDurationSeconds).toBeGreaterThanOrEqual(295 * 60);
      expect(missing).toMatchObject({
        isOpen: false,
        actualDurationSeconds: null,
        booking: { startedAt: null },
      });
      expect(open).toMatchObject({ isOpen: true, actualDurationSeconds: null });
      expect(body.totals).toHaveLength(2);
      expect(
        body.totals.find(({ staffMembershipId }) => staffMembershipId === staff.membershipId),
      ).toMatchObject({ classCount: 1, plannedSeconds: 3600, openCount: 0 });
      expect(
        body.totals.find(({ staffMembershipId }) => staffMembershipId === otherStaff.membershipId),
      ).toMatchObject({ classCount: 0, actualSeconds: 0, openCount: 1 });
    });

    it('filters by professional', async () => {
      await insertBooking({
        clientMembershipId: ana.membershipId,
        staffMembershipId: staff.membershipId,
        startsInMinutes: -200,
      });
      const others = await insertBooking({
        clientMembershipId: ana.membershipId,
        staffMembershipId: otherStaff.membershipId,
        startsInMinutes: -200,
      });

      const response = await world.call(
        'GET',
        recordsUrl(`${todayRange()}&staffMembershipId=${otherStaff.membershipId}`),
        ownerUserId,
        { centerId },
      );

      expect(response.json<RecordsBody>().records.map(({ booking }) => booking.id)).toEqual([
        others,
      ]);
    });

    it.each([
      ['a range of 32 days', 'from=2026-10-01&to=2026-11-01'],
      ['a range that ends before it starts', 'from=2026-10-05&to=2026-10-04'],
      ['an invalid date', 'from=hoy&to=2026-10-04'],
      ['a missing date', 'from=2026-10-05'],
      ['an unknown parameter', 'from=2026-10-05&to=2026-10-05&limit=5'],
    ])('rejects %s with 400', async (_description, query) => {
      const response = await world.call('GET', recordsUrl(query), ownerUserId, { centerId });

      expect(response.statusCode).toBe(400);
    });

    it('accepts exactly 31 days', async () => {
      const response = await world.call(
        'GET',
        recordsUrl('from=2026-10-01&to=2026-10-31'),
        ownerUserId,
        { centerId },
      );

      expect(response.statusCode).toBe(200);
    });

    it('is only for owners and admins with a second factor', async () => {
      const staffResponse = await world.call('GET', recordsUrl(todayRange()), staff.userId, {
        centerId,
      });
      const clientResponse = await world.call('GET', recordsUrl(todayRange()), ana.userId, {
        centerId,
      });
      const withoutSecondFactor = await world.call('GET', recordsUrl(todayRange()), ownerUserId, {
        centerId,
        isMfaVerified: false,
      });
      const adminResponse = await world.call('GET', recordsUrl(todayRange()), admin.userId, {
        centerId,
      });
      const anonymous = await world.call('GET', recordsUrl(todayRange()), undefined, { centerId });

      expect(staffResponse.statusCode).toBe(403);
      expect(clientResponse.statusCode).toBe(403);
      expect(withoutSecondFactor.statusCode).toBe(403);
      expect(withoutSecondFactor.json()).toMatchObject({ code: 'MFA_REQUIRED' });
      expect(adminResponse.statusCode).toBe(200);
      expect(anonymous.statusCode).toBe(401);
    });

    it('does not show the records of one center to the owner of another', async () => {
      await insertBooking({
        clientMembershipId: ana.membershipId,
        staffMembershipId: staff.membershipId,
        startsInMinutes: -200,
      });
      const otherOwner = await world.fixtures.createUser('other-owner');
      const otherCenter = await world.createCenter(otherOwner, 'Otro Centro');

      const peeking = await world.call('GET', recordsUrl(todayRange()), otherOwner, { centerId });
      const own = await world.call(
        'GET',
        `/v1/centers/${otherCenter.centerId}/session-records?${todayRange()}`,
        otherOwner,
        { centerId: otherCenter.centerId },
      );

      expect(peeking.statusCode).toBe(404);
      expect(own.json<RecordsBody>().records).toEqual([]);
    });
  });
});
