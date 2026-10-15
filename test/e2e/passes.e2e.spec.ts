import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { v7 as generateUuidV7 } from 'uuid';
import { BookingWorld, type CreatedTestCenter } from '../support/booking-world';
import { resetTestDatabase } from '../support/test-database';
import { createTestApplication } from './create-test-application';

const MILLISECONDS_PER_MINUTE = 60_000;

interface Person {
  userId: string;
  membershipId: string;
}

interface RateBody {
  id: string;
  name: string;
  sessionsCount: number;
  services: { id: string; name: string }[];
}

interface PassBody {
  id: string;
  status: string;
  totalSessions: number;
  remainingSessions: number;
  expiresAt: string | null;
  client: { membershipId: string };
}

describe('passes (bonos)', () => {
  let application: NestFastifyApplication;
  let world: BookingWorld;
  let ownerUserId: string;
  let center: CreatedTestCenter;
  let centerId: string;
  let serviceId: string;
  let otherServiceId: string;
  let staff: Person;
  let ana: Person;
  let luis: Person;

  const url = (path: string): string => `/v1/centers/${centerId}${path}`;
  const ownerActor = () =>
    ({
      userId: ownerUserId,
      centerId,
      membershipId: center.ownerMembershipId,
      role: 'owner',
      permissions: [],
    }) as const;

  const createRate = async (body: object) =>
    world.call('POST', url('/rates'), ownerUserId, { centerId, body });

  async function createActivePass(client: Person, serviceIds: string[] = []): Promise<PassBody> {
    const rate = (
      await createRate({
        name: 'Bono 10',
        sessionsCount: 10,
        validDays: 30,
        priceCents: 5000,
        serviceIds,
      })
    ).json<RateBody>();
    const assigned = await world.call('POST', url('/passes/assign'), ownerUserId, {
      centerId,
      body: { rateId: rate.id, clientMembershipId: client.membershipId },
    });
    return assigned.json<PassBody>();
  }

  /** Una cita a la hora que se quiera, imposible de crear por la API (huecos pasados o muy próximos). */
  async function insertBooking(
    client: Person,
    options: {
      forService?: string;
      startsInMinutes?: number;
      status?: 'confirmed' | 'cancelled';
    } = {},
  ): Promise<string> {
    const startsAt = new Date(
      Date.now() + (options.startsInMinutes ?? 5) * MILLISECONDS_PER_MINUTE,
    );
    const sessionId = generateUuidV7();
    const bookingId = generateUuidV7();
    await world.tenantPrismaService.runInTenantContext(ownerActor(), async (prisma) => {
      await prisma.classSession.create({
        data: {
          id: sessionId,
          centerId,
          serviceId: options.forService ?? serviceId,
          staffMembershipId: staff.membershipId,
          startsAt,
          endsAt: new Date(startsAt.getTime() + 60 * MILLISECONDS_PER_MINUTE),
        },
      });
      await prisma.booking.create({
        data: {
          id: bookingId,
          centerId,
          classSessionId: sessionId,
          clientMembershipId: client.membershipId,
          status: options.status ?? 'confirmed',
        },
      });
    });
    return bookingId;
  }

  async function attendClass(bookingId: string): Promise<void> {
    await world.call('POST', url(`/bookings/${bookingId}/start`), staff.userId, {
      centerId,
      isMfaVerified: true,
    });
    const ended = await world.call('POST', url(`/bookings/${bookingId}/end`), staff.userId, {
      centerId,
    });
    expect(ended.statusCode).toBe(200);
  }

  const passesOf = async (person: Person): Promise<PassBody[]> =>
    (await world.call('GET', url('/passes/mine'), person.userId, { centerId })).json<{
      passes: PassBody[];
    }>().passes;

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
    ana = await world.addMember(centerId, 'ana', 'client');
    luis = await world.addMember(centerId, 'luis', 'client');
    serviceId = (
      await world.createService(ownerUserId, centerId, { name: 'Karate', durationMinutes: 60 })
    ).id;
    otherServiceId = (
      await world.createService(ownerUserId, centerId, { name: 'Yoga', durationMinutes: 60 })
    ).id;
  });

  afterAll(async () => {
    await application.close();
  });

  describe('rates', () => {
    it('lets the owner create, list, change and remove a pass for sale', async () => {
      const created = await createRate({
        name: 'Bono 10 clases',
        sessionsCount: 10,
        validDays: 60,
        priceCents: 6000,
        serviceIds: [serviceId],
      });
      expect(created.statusCode).toBe(201);
      const rate = created.json<RateBody>();
      expect(rate.services).toEqual([{ id: serviceId, name: 'Karate' }]);

      const changed = await world.call('PATCH', url(`/rates/${rate.id}`), ownerUserId, {
        centerId,
        body: { sessionsCount: 12, serviceIds: [] },
      });
      expect(changed.json<RateBody>()).toMatchObject({ sessionsCount: 12, services: [] });

      const asClient = await world.call('GET', url('/rates'), ana.userId, { centerId });
      expect(asClient.json<{ rates: RateBody[] }>().rates).toHaveLength(1);

      const removed = await world.call('DELETE', url(`/rates/${rate.id}`), ownerUserId, {
        centerId,
      });
      expect(removed.statusCode).toBe(204);
      const after = await world.call('GET', url('/rates'), ana.userId, { centerId });
      expect(after.json<{ rates: RateBody[] }>().rates).toHaveLength(0);
    });

    it('does not let a client create a pass for sale', async () => {
      const response = await world.call('POST', url('/rates'), ana.userId, {
        centerId,
        body: { name: 'Bono gratis', sessionsCount: 1, validDays: 1, priceCents: 0 },
      });

      expect(response.statusCode).toBe(403);
    });
  });

  describe('requesting and activating', () => {
    it('keeps the request pending until the center activates it, and tells both sides', async () => {
      const rate = (
        await createRate({ name: 'Bono 5', sessionsCount: 5, validDays: 30, priceCents: 3000 })
      ).json<RateBody>();

      const requested = await world.call('POST', url(`/rates/${rate.id}/request`), ana.userId, {
        centerId,
      });
      expect(requested.statusCode).toBe(201);
      expect(requested.json<PassBody>()).toMatchObject({ status: 'pending', expiresAt: null });
      const again = await world.call('POST', url(`/rates/${rate.id}/request`), ana.userId, {
        centerId,
      });
      expect(again.statusCode).toBe(409);

      const pendingForCenter = await world.call('GET', url('/passes?status=pending'), ownerUserId, {
        centerId,
      });
      const [pending] = pendingForCenter.json<{ passes: PassBody[] }>().passes;
      expect(pending?.client.membershipId).toBe(ana.membershipId);

      const activated = await world.call(
        'POST',
        url(`/passes/${pending?.id ?? ''}/activate`),
        ownerUserId,
        { centerId },
      );
      expect(activated.json<PassBody>()).toMatchObject({
        status: 'active',
        remainingSessions: 5,
        expiresAt: expect.stringMatching(/Z$/) as string,
      });
      const notices = await world.call('GET', url('/notifications'), ana.userId, { centerId });
      expect(
        notices.json<{ notifications: { kind: string }[] }>().notifications.map(({ kind }) => kind),
      ).toContain('pass_activated');
      const centerNotices = await world.call('GET', url('/notifications'), ownerUserId, {
        centerId,
      });
      expect(
        centerNotices
          .json<{ notifications: { kind: string }[] }>()
          .notifications.map(({ kind }) => kind),
      ).toContain('pass_requested');
    });

    it('only shows a client their own passes', async () => {
      await createActivePass(ana);

      expect(await passesOf(ana)).toHaveLength(1);
      expect(await passesOf(luis)).toHaveLength(0);
    });
  });

  describe('removing an assigned pass', () => {
    it('lets the center remove a pass that was assigned by mistake, and it stops being listed and used', async () => {
      const pass = await createActivePass(ana);
      const bookingId = await insertBooking(ana);

      const removed = await world.call('DELETE', url(`/passes/${pass.id}`), ownerUserId, {
        centerId,
      });
      await attendClass(bookingId);

      expect(removed.statusCode).toBe(204);
      expect(await passesOf(ana)).toEqual([]);
      const forCenter = await world.call('GET', url('/passes'), ownerUserId, { centerId });
      expect(forCenter.json<{ passes: PassBody[] }>().passes).toEqual([]);
    });

    it('answers 404 when it was already removed, and does not let a client remove one', async () => {
      const pass = await createActivePass(ana);

      const asClient = await world.call('DELETE', url(`/passes/${pass.id}`), ana.userId, {
        centerId,
      });
      await world.call('DELETE', url(`/passes/${pass.id}`), ownerUserId, { centerId });
      const again = await world.call('DELETE', url(`/passes/${pass.id}`), ownerUserId, {
        centerId,
      });

      expect(asClient.statusCode).toBe(403);
      expect(again.statusCode).toBe(404);
    });
  });

  describe('running out', () => {
    it('warns the client when one class is left and again when the pass is used up', async () => {
      const rate = (
        await createRate({ name: 'Bono 2', sessionsCount: 2, validDays: 30, priceCents: 1000 })
      ).json<RateBody>();
      await world.call('POST', url('/passes/assign'), ownerUserId, {
        centerId,
        body: { rateId: rate.id, clientMembershipId: ana.membershipId },
      });
      const kindsOfNotices = async (): Promise<string[]> =>
        (await world.call('GET', url('/notifications'), ana.userId, { centerId }))
          .json<{ notifications: { kind: string }[] }>()
          .notifications.map(({ kind }) => kind);

      await attendClass(await insertBooking(ana));
      expect(await kindsOfNotices()).toContain('pass_running_low');
      expect(await kindsOfNotices()).not.toContain('pass_exhausted');

      const secondBookingId = await insertBooking(ana, { startsInMinutes: -180 });
      await world.call('POST', url(`/bookings/${secondBookingId}/attendance`), staff.userId, {
        centerId,
      });
      expect(await kindsOfNotices()).toContain('pass_exhausted');
    });
  });

  describe('using a class', () => {
    it('takes one class off the pass when the class is finished, and only once', async () => {
      const pass = await createActivePass(ana);
      const bookingId = await insertBooking(ana);

      await attendClass(bookingId);
      await world.call('POST', url(`/bookings/${bookingId}/end`), staff.userId, { centerId });

      const [after] = await passesOf(ana);
      expect(after).toMatchObject({ id: pass.id, remainingSessions: 9, status: 'active' });
    });

    it('takes one class off the pass when the teacher confirms attendance, and only once', async () => {
      const pass = await createActivePass(ana);
      const bookingId = await insertBooking(ana);

      const first = await world.call(
        'POST',
        url(`/bookings/${bookingId}/attendance`),
        staff.userId,
        {
          centerId,
        },
      );
      const second = await world.call(
        'POST',
        url(`/bookings/${bookingId}/attendance`),
        staff.userId,
        {
          centerId,
        },
      );

      expect(first.statusCode).toBe(200);
      expect(first.json<{ checkedInAt: string | null }>().checkedInAt).not.toBeNull();
      expect(second.json<{ checkedInAt: string }>().checkedInAt).toBe(
        first.json<{ checkedInAt: string }>().checkedInAt,
      );
      const [after] = await passesOf(ana);
      expect(after).toMatchObject({ id: pass.id, remainingSessions: 9 });
      await attendClass(bookingId);
      expect((await passesOf(ana))[0]?.remainingSessions).toBe(9);
    });

    it('does not let another teacher confirm the attendance of a class that is not theirs', async () => {
      await createActivePass(ana);
      const bookingId = await insertBooking(ana);
      const otherTeacher = await world.addMember(centerId, 'other', 'staff');

      const response = await world.call(
        'POST',
        url(`/bookings/${bookingId}/attendance`),
        otherTeacher.userId,
        { centerId },
      );

      expect(response.statusCode).toBe(404);
      expect((await passesOf(ana))[0]?.remainingSessions).toBe(10);
    });

    it('takes the class off when the person did not come and did not cancel, once the class ended', async () => {
      await createActivePass(ana);
      await insertBooking(ana, { startsInMinutes: -180 });

      const [after] = await passesOf(ana);

      expect(after?.remainingSessions).toBe(9);
      expect((await passesOf(ana))[0]?.remainingSessions).toBe(9);
    });

    it('does not take a class off for a cancelled appointment', async () => {
      await createActivePass(ana);
      await insertBooking(ana, { startsInMinutes: -180, status: 'cancelled' });

      const [after] = await passesOf(ana);

      expect(after?.remainingSessions).toBe(10);
    });

    it('does not take a second class off when the teacher confirms a no-show afterwards', async () => {
      await createActivePass(ana);
      const bookingId = await insertBooking(ana, { startsInMinutes: -180 });
      expect((await passesOf(ana))[0]?.remainingSessions).toBe(9);

      const confirmed = await world.call(
        'POST',
        url(`/bookings/${bookingId}/attendance`),
        staff.userId,
        { centerId },
      );

      expect(confirmed.statusCode).toBe(200);
      expect(confirmed.json<{ status: string }>().status).toBe('attended');
      expect((await passesOf(ana))[0]?.remainingSessions).toBe(9);
    });

    it('does not take a class off a pass that is for another service', async () => {
      await createActivePass(ana, [otherServiceId]);
      const bookingId = await insertBooking(ana, { forService: serviceId });

      await attendClass(bookingId);

      const [after] = await passesOf(ana);
      expect(after?.remainingSessions).toBe(10);
    });

    it('does not take a class off a pass that is still pending', async () => {
      const rate = (
        await createRate({ name: 'Bono 5', sessionsCount: 5, validDays: 30, priceCents: 3000 })
      ).json<RateBody>();
      await world.call('POST', url(`/rates/${rate.id}/request`), ana.userId, { centerId });
      const bookingId = await insertBooking(ana);

      await attendClass(bookingId);

      const [after] = await passesOf(ana);
      expect(after).toMatchObject({ status: 'pending', remainingSessions: 5 });
    });
  });
});
