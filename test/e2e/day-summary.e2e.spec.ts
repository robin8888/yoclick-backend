import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { v7 as generateUuidV7 } from 'uuid';
import { BookingWorld, localDateOf } from '../support/booking-world';
import { resetTestDatabase } from '../support/test-database';
import { createTestApplication } from './create-test-application';

const MILLISECONDS_PER_MINUTE = 60_000;
const SESSION_MINUTES = 60;
const MINUTES_PER_OPEN_DAY = 24 * 60;
// El alta del centro asigna al propietario a su primer servicio: atienden él y la profesional.
const BOOKABLE_STAFF_COUNT = 2;

interface DaySummaryBody {
  date: string;
  occupancyPercent: number | null;
  newClientsThisWeek: number;
  activeClientCount: number;
}

describe('GET /centers/:centerId/agenda/summary', () => {
  let application: NestFastifyApplication;
  let world: BookingWorld;
  let ownerUserId: string;
  let centerId: string;
  let ownerMembershipId: string;
  let serviceId: string;
  let staffMembershipId: string;
  let staffUserId: string;
  let clientUserId: string;
  let clientMembershipId: string;

  const ownerActor = () =>
    ({
      userId: ownerUserId,
      centerId,
      membershipId: ownerMembershipId,
      role: 'owner',
      permissions: [],
    }) as const;

  async function insertSession(
    startsAt: Date,
    status: 'confirmed' | 'cancelled' = 'confirmed',
  ): Promise<void> {
    const sessionId = generateUuidV7();
    await world.tenantPrismaService.runInTenantContext(ownerActor(), async (prisma) => {
      await prisma.classSession.create({
        data: {
          id: sessionId,
          centerId,
          serviceId,
          staffMembershipId,
          startsAt,
          endsAt: new Date(startsAt.getTime() + SESSION_MINUTES * MILLISECONDS_PER_MINUTE),
        },
      });
      await prisma.booking.create({
        data: {
          id: generateUuidV7(),
          centerId,
          classSessionId: sessionId,
          clientMembershipId,
          status,
        },
      });
    });
  }

  const getSummary = (userId: string, date: string, isMfaVerified = true) =>
    world.call('GET', `/v1/centers/${centerId}/agenda/summary?date=${date}`, userId, {
      centerId,
      isMfaVerified,
    });

  beforeAll(async () => {
    application = await createTestApplication();
    world = new BookingWorld(application);
  });

  beforeEach(async () => {
    await resetTestDatabase();
    ownerUserId = await world.fixtures.createUser('owner');
    const center = await world.createCenter(ownerUserId);
    centerId = center.centerId;
    ownerMembershipId = center.ownerMembershipId;
    await world.openAllWeek(ownerUserId, centerId);
    ({ userId: staffUserId, membershipId: staffMembershipId } = await world.addMember(
      centerId,
      'staff',
      'staff',
    ));
    ({ userId: clientUserId, membershipId: clientMembershipId } = await world.addMember(
      centerId,
      'ana',
      'client',
    ));
    serviceId = (
      await world.createService(ownerUserId, centerId, {
        name: 'Sesión personal',
        durationMinutes: SESSION_MINUTES,
        staffMembershipIds: [staffMembershipId],
      })
    ).id;
  });

  afterAll(async () => {
    await application.close();
  });

  it('reports occupancy, new clients of the week and active clients', async () => {
    const startsAt = new Date(Date.now() + 2 * SESSION_MINUTES * MILLISECONDS_PER_MINUTE);
    await insertSession(startsAt);

    const response = await getSummary(ownerUserId, localDateOf(startsAt.toISOString()));

    expect(response.statusCode).toBe(200);
    expect(response.json<DaySummaryBody>()).toMatchObject({
      occupancyPercent: Math.round(
        (SESSION_MINUTES / (MINUTES_PER_OPEN_DAY * BOOKABLE_STAFF_COUNT)) * 100,
      ),
      newClientsThisWeek: 1,
      activeClientCount: 1,
    });
  });

  it('does not count cancelled bookings as occupied time', async () => {
    const startsAt = new Date(Date.now() + 2 * SESSION_MINUTES * MILLISECONDS_PER_MINUTE);
    await insertSession(startsAt, 'cancelled');

    const response = await getSummary(ownerUserId, localDateOf(startsAt.toISOString()));

    expect(response.json<DaySummaryBody>().occupancyPercent).toBe(0);
  });

  it('has no occupancy on a day the center is closed', async () => {
    const current = await world.call('GET', `/v1/centers/${centerId}`, ownerUserId, { centerId });
    await world.call('PATCH', `/v1/centers/${centerId}`, ownerUserId, {
      centerId,
      headers: { 'if-match': String(current.headers['etag']) },
      body: { openingHours: {} },
    });

    const response = await getSummary(ownerUserId, '2026-09-29');

    expect(response.json<DaySummaryBody>().occupancyPercent).toBeNull();
  });

  it('is for administration only and needs the second factor', async () => {
    expect((await getSummary(staffUserId, '2026-09-29')).statusCode).toBe(403);
    expect((await getSummary(clientUserId, '2026-09-29')).statusCode).toBe(403);
    const withoutSecondFactor = await getSummary(ownerUserId, '2026-09-29', false);
    expect(withoutSecondFactor.statusCode).toBe(403);
    expect(withoutSecondFactor.json<{ code: string }>().code).toBe('MFA_REQUIRED');
  });

  it('rejects a missing or malformed date', async () => {
    const response = await getSummary(ownerUserId, 'not-a-date');

    expect(response.statusCode).toBe(400);
  });

  it('never shows another center numbers', async () => {
    const otherOwnerId = await world.fixtures.createUser('otherowner');
    const otherCenter = await world.createCenter(otherOwnerId, 'Otro centro');

    const response = await world.call(
      'GET',
      `/v1/centers/${otherCenter.centerId}/agenda/summary?date=2026-09-29`,
      otherOwnerId,
      { centerId: otherCenter.centerId },
    );

    expect(response.json<DaySummaryBody>()).toMatchObject({
      newClientsThisWeek: 0,
      activeClientCount: 0,
    });
  });
});
