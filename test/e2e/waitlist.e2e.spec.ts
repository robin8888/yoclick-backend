import { randomUUID } from 'node:crypto';
import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { v7 as generateUuidV7 } from 'uuid';
import { WaitlistAdvancer } from '../../src/modules/waitlist/application/waitlist.use-cases';
import { BookingWorld, type CreatedTestCenter } from '../support/booking-world';
import { resetTestDatabase } from '../support/test-database';
import { createTestApplication } from './create-test-application';

const HOUR_MS = 3_600_000;
const SESSION_CAPACITY = 2;

interface Person {
  userId: string;
  membershipId: string;
}

interface EntryBody {
  id: string;
  status: 'waiting' | 'offered';
  position: number | null;
  offerExpiresAt: string | null;
}

describe('waitlist (lista de espera de las clases llenas)', () => {
  let application: NestFastifyApplication;
  let world: BookingWorld;
  let advancer: WaitlistAdvancer;
  let ownerUserId: string;
  let center: CreatedTestCenter;
  let centerId: string;
  let sessionId: string;
  let ana: Person;
  let luis: Person;
  let marco: Person;
  let eva: Person;
  let anaBookingId: string;

  const url = (path: string): string => `/v1/centers/${centerId}${path}`;
  const ownerActor = () =>
    ({
      userId: ownerUserId,
      centerId,
      membershipId: center.ownerMembershipId,
      role: 'owner',
      permissions: [],
    }) as const;

  async function insertBooking(client: Person): Promise<string> {
    const bookingId = generateUuidV7();
    await world.tenantPrismaService.runInTenantContext(ownerActor(), async (prisma) => {
      await prisma.booking.create({
        data: {
          id: bookingId,
          centerId,
          classSessionId: sessionId,
          clientMembershipId: client.membershipId,
        },
      });
    });
    return bookingId;
  }

  const joinWaitlist = async (client: Person) =>
    world.call('POST', url(`/class-sessions/${sessionId}/waitlist`), client.userId, { centerId });

  async function myEntry(client: Person): Promise<EntryBody | undefined> {
    const response = await world.call('GET', url('/waitlist/mine'), client.userId, { centerId });
    return response.json<{ entries: EntryBody[] }>().entries[0];
  }

  async function kindsOfNotices(client: Person): Promise<string[]> {
    const response = await world.call('GET', url('/notifications'), client.userId, { centerId });
    return response
      .json<{ notifications: { kind: string }[] }>()
      .notifications.map(({ kind }) => kind);
  }

  async function makeOfferExpire(client: Person): Promise<void> {
    await world.tenantPrismaService.runInTenantContext(ownerActor(), async (prisma) => {
      await prisma.waitlistEntry.updateMany({
        where: { clientMembershipId: client.membershipId, status: 'offered' },
        data: { offerExpiresAt: new Date(Date.now() - HOUR_MS) },
      });
    });
  }

  beforeAll(async () => {
    application = await createTestApplication();
    world = new BookingWorld(application);
    advancer = application.get(WaitlistAdvancer);
  });

  beforeEach(async () => {
    await resetTestDatabase();
    ownerUserId = await world.fixtures.createUser('owner');
    center = await world.createCenter(ownerUserId);
    centerId = center.centerId;
    const teacher = await world.addMember(centerId, 'teacher', 'staff');
    ana = await world.addMember(centerId, 'ana', 'client');
    luis = await world.addMember(centerId, 'luis', 'client');
    marco = await world.addMember(centerId, 'marco', 'client');
    eva = await world.addMember(centerId, 'eva', 'client');
    const service = await world.createService(ownerUserId, centerId, {
      name: 'Pilates',
      durationMinutes: 60,
    });
    sessionId = generateUuidV7();
    const startsAt = new Date(Date.now() + 72 * HOUR_MS);
    await world.tenantPrismaService.runInTenantContext(ownerActor(), async (prisma) => {
      await prisma.classSession.create({
        data: {
          id: sessionId,
          centerId,
          serviceId: service.id,
          staffMembershipId: teacher.membershipId,
          startsAt,
          endsAt: new Date(startsAt.getTime() + HOUR_MS),
          mode: 'group',
          capacity: SESSION_CAPACITY,
        },
      });
    });
    anaBookingId = await insertBooking(ana);
  });

  afterAll(async () => {
    await application.close();
  });

  it('refuses the waitlist while the class still has seats', async () => {
    const response = await joinWaitlist(marco);

    expect(response.statusCode).toBe(409);
    expect(response.json<{ code: string }>().code).toBe('WAITLIST_SESSION_HAS_SEATS');
  });

  it('keeps a group class open when one of its people cancels', async () => {
    await insertBooking(luis);

    await world.call('POST', url(`/bookings/${anaBookingId}/cancel`), ana.userId, { centerId });

    const session = await world.tenantPrismaService.runInTenantContext(
      ownerActor(),
      async (prisma) => prisma.classSession.findUniqueOrThrow({ where: { id: sessionId } }),
    );
    expect(session.status).toBe('scheduled');
  });

  it('does not exist for a person from another center', async () => {
    await insertBooking(luis);
    const otherOwnerId = await world.fixtures.createUser('other-owner');
    const otherCenter = await world.createCenter(otherOwnerId, 'Otro centro');
    const stranger = await world.addMember(otherCenter.centerId, 'stranger', 'client');

    const response = await world.call(
      'POST',
      url(`/class-sessions/${sessionId}/waitlist`),
      stranger.userId,
      {
        centerId,
      },
    );

    expect(response.statusCode).toBe(404);
  });

  describe('with a full class', () => {
    beforeEach(async () => {
      await insertBooking(luis);
    });

    it('queues people in order of arrival and refuses to join twice', async () => {
      const first = await joinWaitlist(marco);
      const second = await joinWaitlist(eva);
      const again = await joinWaitlist(marco);

      expect(first.statusCode).toBe(201);
      expect(first.json<EntryBody>()).toMatchObject({ status: 'waiting', position: 1 });
      expect(second.json<EntryBody>().position).toBe(2);
      expect(again.statusCode).toBe(409);
      expect(again.json<{ code: string }>().code).toBe('WAITLIST_ALREADY_JOINED');
      const asBooked = await joinWaitlist(ana);
      expect(asBooked.json<{ code: string }>().code).toBe('ALREADY_BOOKED');
    });

    it('offers the freed seat to the first person, who has 12 hours to confirm it', async () => {
      await joinWaitlist(marco);
      await joinWaitlist(eva);

      await world.call('POST', url(`/bookings/${anaBookingId}/cancel`), ana.userId, { centerId });

      const offer = await myEntry(marco);
      expect(offer).toMatchObject({ status: 'offered', position: null });
      const hoursToConfirm = (Date.parse(offer?.offerExpiresAt ?? '') - Date.now()) / HOUR_MS;
      expect(hoursToConfirm).toBeGreaterThan(11.9);
      expect(hoursToConfirm).toBeLessThanOrEqual(12);
      expect(await kindsOfNotices(marco)).toContain('waitlist_offer');
      expect(await myEntry(eva)).toMatchObject({ status: 'waiting', position: 1 });
      expect(await kindsOfNotices(eva)).not.toContain('waitlist_offer');
    });

    it('holds the offered seat for its owner and books it on confirmation', async () => {
      const entry = (await joinWaitlist(marco)).json<EntryBody>();
      await world.call('POST', url(`/bookings/${anaBookingId}/cancel`), ana.userId, { centerId });

      const stolen = await world.call('POST', url('/bookings/join-session'), eva.userId, {
        centerId,
        body: { classSessionId: sessionId },
        headers: { 'idempotency-key': randomUUID() },
      });
      const confirmed = await world.call(
        'POST',
        url(`/waitlist/${entry.id}/confirm`),
        marco.userId,
        {
          centerId,
        },
      );

      expect(stolen.statusCode).toBe(409);
      expect(stolen.json<{ code: string }>().code).toBe('SESSION_FULL');
      expect(confirmed.statusCode).toBe(201);
      expect(confirmed.json<{ status: string }>().status).toBe('confirmed');
      expect(await myEntry(marco)).toBeUndefined();
    });

    it('passes the seat to the next person when the 12 hours run out', async () => {
      const entry = (await joinWaitlist(marco)).json<EntryBody>();
      await joinWaitlist(eva);
      await world.call('POST', url(`/bookings/${anaBookingId}/cancel`), ana.userId, { centerId });
      await makeOfferExpire(marco);

      await advancer.sweepExpiredOffers();

      expect(await myEntry(marco)).toBeUndefined();
      expect(await kindsOfNotices(marco)).toContain('waitlist_offer_expired');
      expect(await myEntry(eva)).toMatchObject({ status: 'offered' });
      expect(await kindsOfNotices(eva)).toContain('waitlist_offer');
      const late = await world.call('POST', url(`/waitlist/${entry.id}/confirm`), marco.userId, {
        centerId,
      });
      expect(late.statusCode).toBe(404);
    });

    it('refuses to confirm an offer whose time ran out before the sweep', async () => {
      const entry = (await joinWaitlist(marco)).json<EntryBody>();
      await world.call('POST', url(`/bookings/${anaBookingId}/cancel`), ana.userId, { centerId });
      await makeOfferExpire(marco);

      const late = await world.call('POST', url(`/waitlist/${entry.id}/confirm`), marco.userId, {
        centerId,
      });

      expect(late.statusCode).toBe(409);
      expect(late.json<{ code: string }>().code).toBe('WAITLIST_OFFER_EXPIRED');
    });

    it('passes an offered seat on when its owner gives it up', async () => {
      const entry = (await joinWaitlist(marco)).json<EntryBody>();
      await joinWaitlist(eva);
      await world.call('POST', url(`/bookings/${anaBookingId}/cancel`), ana.userId, { centerId });

      const left = await world.call('POST', url(`/waitlist/${entry.id}/leave`), marco.userId, {
        centerId,
      });

      expect(left.statusCode).toBe(204);
      expect(await myEntry(marco)).toBeUndefined();
      expect(await myEntry(eva)).toMatchObject({ status: 'offered' });
    });

    it('never lets someone else leave or confirm a waitlist entry that is not theirs', async () => {
      const entry = (await joinWaitlist(marco)).json<EntryBody>();

      const leave = await world.call('POST', url(`/waitlist/${entry.id}/leave`), eva.userId, {
        centerId,
      });
      const confirm = await world.call('POST', url(`/waitlist/${entry.id}/confirm`), eva.userId, {
        centerId,
      });

      expect(leave.statusCode).toBe(404);
      expect(confirm.statusCode).toBe(404);
      expect(await myEntry(marco)).toMatchObject({ status: 'waiting' });
    });
  });
});
