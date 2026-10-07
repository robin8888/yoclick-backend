import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { v7 as generateUuidV7 } from 'uuid';
import { BookingWorld } from '../support/booking-world';
import { resetTestDatabase } from '../support/test-database';
import { createTestApplication } from './create-test-application';

const MILLISECONDS_PER_MINUTE = 60_000;
const MILLISECONDS_PER_DAY = 86_400_000;
const SESSION_MINUTES = 60;
const SERVICE_PRICE_CENTS = 3500;
const JOINED_DAYS_AGO = 100;

interface ReportBody {
  period: string;
  estimatedIncomeCents: number;
  averageOccupancyPercent: number | null;
  activeClientCount: number;
  inactiveClientCount: number;
  incomeByMonth: { month: string; incomeCents: number }[];
  services: { name: string; sessionCount: number }[];
  staff: { fullName: string; sessionCount: number; hours: number }[];
  retentionThreeMonthsPercent: number | null;
  retentionByJoinMonth: { month: string; joinedCount: number }[];
}

describe('GET /centers/:centerId/reports', () => {
  let application: NestFastifyApplication;
  let world: BookingWorld;
  let ownerUserId: string;
  let centerId: string;
  let ownerMembershipId: string;
  let serviceId: string;
  let staff: { userId: string; membershipId: string };
  let clientMembershipId: string;

  const ownerActor = () =>
    ({
      userId: ownerUserId,
      centerId,
      membershipId: ownerMembershipId,
      role: 'owner',
      permissions: [],
    }) as const;

  async function insertAttendedSession(daysAgo: number): Promise<void> {
    const startsAt = new Date(Date.now() - daysAgo * MILLISECONDS_PER_DAY);
    const sessionId = generateUuidV7();
    await world.tenantPrismaService.runInTenantContext(ownerActor(), async (prisma) => {
      await prisma.classSession.create({
        data: {
          id: sessionId,
          centerId,
          serviceId,
          staffMembershipId: staff.membershipId,
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
          status: 'attended',
        },
      });
    });
  }

  const getReport = (userId: string, query = '') =>
    world.call('GET', `/v1/centers/${centerId}/reports${query}`, userId, { centerId });

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
    staff = await world.addMember(centerId, 'marta', 'staff');
    ({ membershipId: clientMembershipId } = await world.addMember(centerId, 'ana', 'client'));
    await world.tenantPrismaService.runInTenantContext(ownerActor(), (prisma) =>
      prisma.membership.update({
        where: { id: clientMembershipId },
        data: { joinedAt: new Date(Date.now() - JOINED_DAYS_AGO * MILLISECONDS_PER_DAY) },
      }),
    );
    serviceId = (
      await world.createService(ownerUserId, centerId, {
        name: 'Sesión personal',
        durationMinutes: SESSION_MINUTES,
        priceCents: SERVICE_PRICE_CENTS,
        staffMembershipIds: [staff.membershipId],
      })
    ).id;
  });

  afterAll(async () => {
    await application.close();
  });

  it('summarizes the month: income, services, staff hours and clients', async () => {
    await insertAttendedSession(2);
    await insertAttendedSession(5);

    const response = await getReport(ownerUserId);

    expect(response.statusCode).toBe(200);
    const report = response.json<ReportBody>();
    expect(report).toMatchObject({
      period: 'month',
      estimatedIncomeCents: 2 * SERVICE_PRICE_CENTS,
      activeClientCount: 1,
      inactiveClientCount: 0,
    });
    expect(report.services).toMatchObject([{ name: 'Sesión personal', sessionCount: 2 }]);
    expect(report.staff).toMatchObject([{ fullName: 'marta', sessionCount: 2, hours: 2 }]);
    expect(report.incomeByMonth).toHaveLength(6);
    expect(report.retentionThreeMonthsPercent).toBe(100);
    expect(report.retentionByJoinMonth).toHaveLength(4);
  });

  it('leaves out of a week what happened before it', async () => {
    await insertAttendedSession(20);

    const week = (await getReport(ownerUserId, '?period=week')).json<ReportBody>();
    const month = (await getReport(ownerUserId, '?period=month')).json<ReportBody>();

    expect(week.estimatedIncomeCents).toBe(0);
    expect(month.estimatedIncomeCents).toBe(SERVICE_PRICE_CENTS);
  });

  it('rejects an unknown period', async () => {
    expect((await getReport(ownerUserId, '?period=year')).statusCode).toBe(400);
  });

  it('is only for owners and admins', async () => {
    expect((await getReport(staff.userId)).statusCode).toBe(403);
  });
});
