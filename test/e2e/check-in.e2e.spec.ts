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

interface CheckInCodeBody {
  qrContent: string;
  expiresAt: string;
}

interface CheckInBody {
  clientFullName: string;
  checkedInAt: string;
  isFirstCheckIn: boolean;
  booking: { id: string; status: string };
}

interface ProblemBody {
  code: string;
}

describe('attendance check-in by QR', () => {
  let application: NestFastifyApplication;
  let world: BookingWorld;
  let ownerUserId: string;
  let center: CreatedTestCenter;
  let centerId: string;
  let serviceId: string;
  let staff: Person;
  let otherStaff: Person;
  let ana: Person;

  const issueUrl = (): string => `/v1/centers/${centerId}/me/checkin-code`;
  const checkInUrl = (): string => `/v1/centers/${centerId}/attendance/check-in`;
  const ownerActor = () =>
    ({
      userId: ownerUserId,
      centerId,
      membershipId: center.ownerMembershipId,
      role: 'owner',
      permissions: [],
    }) as const;

  async function insertBooking(startsInMinutes: number, status = 'confirmed'): Promise<string> {
    const startsAt = new Date(Date.now() + startsInMinutes * MILLISECONDS_PER_MINUTE);
    const endsAt = new Date(startsAt.getTime() + 60 * MILLISECONDS_PER_MINUTE);
    const sessionId = generateUuidV7();
    const bookingId = generateUuidV7();
    await world.tenantPrismaService.runInTenantContext(ownerActor(), async (prisma) => {
      await prisma.classSession.create({
        data: {
          id: sessionId,
          centerId,
          serviceId,
          staffMembershipId: staff.membershipId,
          startsAt,
          endsAt,
        },
      });
      await prisma.booking.create({
        data: {
          id: bookingId,
          centerId,
          classSessionId: sessionId,
          clientMembershipId: ana.membershipId,
          status: status as 'confirmed' | 'cancelled',
        },
      });
    });
    return bookingId;
  }

  async function issueCodeAsAna(): Promise<string> {
    const response = await world.call('POST', issueUrl(), ana.userId, { centerId });
    expect(response.statusCode).toBe(200);
    return response.json<CheckInCodeBody>().qrContent;
  }

  async function scanAs(person: Person, qrContent: string) {
    return world.call('POST', checkInUrl(), person.userId, { centerId, body: { qrContent } });
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

  it('issues a short-lived QR for the client and registers the arrival when the professional scans it', async () => {
    const bookingId = await insertBooking(20);
    const issued = await world.call('POST', issueUrl(), ana.userId, { centerId });
    const issuedBody = issued.json<CheckInCodeBody>();

    expect(issuedBody.qrContent).toMatch(/^yoclick:checkin:[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(Date.parse(issuedBody.expiresAt) - Date.now()).toBeLessThanOrEqual(300_000);

    const scanned = await scanAs(staff, issuedBody.qrContent);

    expect(scanned.statusCode).toBe(200);
    expect(scanned.json<CheckInBody>()).toMatchObject({
      isFirstCheckIn: true,
      booking: { id: bookingId, status: 'confirmed' },
    });
    expect(scanned.json<CheckInBody>().clientFullName).toEqual(expect.any(String));
  });

  it('is idempotent: scanning again answers the same arrival', async () => {
    await insertBooking(5);
    const qrContent = await issueCodeAsAna();
    const first = (await scanAs(staff, qrContent)).json<CheckInBody>();
    const second = await scanAs(staff, qrContent);

    expect(second.statusCode).toBe(200);
    expect(second.json<CheckInBody>()).toEqual({ ...first, isFirstCheckIn: false });
  });

  it('does not register an arrival for a class the professional does not run', async () => {
    await insertBooking(5);
    const response = await scanAs(otherStaff, await issueCodeAsAna());

    expect(response.statusCode).toBe(409);
    expect(response.json<ProblemBody>().code).toBe('CHECKIN_NO_BOOKING');
  });

  it.each([
    ['too early (more than an hour before)', 90, 'confirmed'],
    ['already finished', -90, 'confirmed'],
    ['cancelled', 10, 'cancelled'],
  ])('answers 409 when the booking is %s', async (_caseName, startsInMinutes, status) => {
    await insertBooking(startsInMinutes, status);
    const response = await scanAs(staff, await issueCodeAsAna());

    expect(response.statusCode).toBe(409);
    expect(response.json<ProblemBody>().code).toBe('CHECKIN_NO_BOOKING');
  });

  it.each([
    'https://yoclick.app/j/NORTE7',
    'yoclick:checkin:no-es-un-token',
    'yoclick:checkin:aaa.bbb.ccc',
  ])('rejects the fake content «%s» with 422', async (qrContent) => {
    await insertBooking(5);
    const response = await scanAs(staff, qrContent);

    expect(response.statusCode).toBe(422);
    expect(response.json<ProblemBody>().code).toBe('CHECKIN_CODE_INVALID');
  });

  it('keeps the roles apart: clients cannot scan and the team cannot issue a client code', async () => {
    const qrContent = await issueCodeAsAna();

    expect((await scanAs(ana, qrContent)).statusCode).toBe(403);
    expect((await world.call('POST', issueUrl(), staff.userId, { centerId })).statusCode).toBe(403);
  });

  it('refuses a client that already left the center', async () => {
    await insertBooking(5);
    const qrContent = await issueCodeAsAna();
    await world.tenantPrismaService.runInTenantContext(ownerActor(), async (prisma) => {
      await prisma.membership.update({ where: { id: ana.membershipId }, data: { status: 'left' } });
    });

    const response = await scanAs(staff, qrContent);

    expect(response.statusCode).toBe(422);
    expect(response.json<ProblemBody>().code).toBe('CHECKIN_CODE_INVALID');
  });
});
