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
  kind: 'client' | 'staff';
  clientFullName: string;
  checkedInAt?: string | null;
  isFirstCheckIn: boolean;
  booking?: { id: string; status: string };
  person: { membershipId: string; fullName: string; photoUrl: string | null; role: string };
  access: {
    isGranted: boolean;
    reason: string;
    pass: { name: string; remainingSessions: number; totalSessions: number } | null;
  };
}

interface PassOverrides {
  status?: 'pending' | 'active' | 'rejected' | 'cancelled';
  remainingSessions?: number;
  expiresAt?: Date | null;
  hasPass?: boolean;
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

  async function insertRateAndPass(overrides: PassOverrides): Promise<void> {
    const rateId = generateUuidV7();
    const thirtyDaysFromNow = new Date(Date.now() + 30 * 24 * 60 * MILLISECONDS_PER_MINUTE);
    await world.tenantPrismaService.runInTenantContext(ownerActor(), async (prisma) => {
      await prisma.rate.create({
        data: {
          id: rateId,
          centerId,
          name: 'Bono 10',
          sessionsCount: 10,
          validDays: 30,
          priceCents: 5000,
          serviceIds: [],
        },
      });
      if (overrides.hasPass === false) return;
      await prisma.clientPass.create({
        data: {
          id: generateUuidV7(),
          centerId,
          clientMembershipId: ana.membershipId,
          rateId,
          name: 'Bono 10',
          totalSessions: 10,
          remainingSessions: overrides.remainingSessions ?? 4,
          priceCents: 5000,
          serviceIds: [],
          status: overrides.status ?? 'active',
          isRequestedByClient: false,
          expiresAt: overrides.expiresAt === undefined ? thirtyDaysFromNow : overrides.expiresAt,
        },
      });
    });
  }

  async function readCheckedInAt(bookingId: string): Promise<Date | null> {
    const stored = await world.tenantPrismaService.runInTenantContext(ownerActor(), (prisma) =>
      prisma.booking.findUniqueOrThrow({ where: { id: bookingId } }),
    );
    return stored.checkedInAt;
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
    const bookingId = await insertBooking(5);
    const response = await scanAs(otherStaff, await issueCodeAsAna());

    expect(response.statusCode).toBe(200);
    expect(response.json<CheckInBody>()).toMatchObject({
      kind: 'client',
      access: { isGranted: true, reason: 'passes_not_required' },
      isFirstCheckIn: false,
    });
    expect(response.json<CheckInBody>().booking).toBeUndefined();
    expect(response.json<CheckInBody>().checkedInAt ?? null).toBeNull();
    expect(await readCheckedInAt(bookingId)).toBeNull();
  });

  it.each([
    ['too early (more than an hour before)', 90, 'confirmed'],
    ['already finished', -90, 'confirmed'],
    ['cancelled', 10, 'cancelled'],
  ])('answers 200 without a booking when it is %s', async (_caseName, startsInMinutes, status) => {
    await insertBooking(startsInMinutes, status);
    const response = await scanAs(staff, await issueCodeAsAna());

    expect(response.statusCode).toBe(200);
    expect(response.json<CheckInBody>().booking).toBeUndefined();
    expect(response.json<CheckInBody>().access.isGranted).toBe(true);
  });

  it('identifies the person scanned with name, photo and role', async () => {
    const response = await scanAs(staff, await issueCodeAsAna());

    expect(response.json<CheckInBody>().person).toEqual({
      membershipId: ana.membershipId,
      fullName: expect.any(String),
      photoUrl: null,
      role: 'client',
    });
  });

  describe('pass-based access', () => {
    it('grants access and registers the arrival with a valid pass', async () => {
      await insertRateAndPass({});
      const bookingId = await insertBooking(5);

      const body = (await scanAs(staff, await issueCodeAsAna())).json<CheckInBody>();

      expect(body.access).toMatchObject({
        isGranted: true,
        reason: 'valid_pass',
        pass: { name: 'Bono 10', remainingSessions: 4, totalSessions: 10 },
      });
      expect(body.booking?.id).toBe(bookingId);
    });

    it.each([
      ['no pass at all', { hasPass: false }, 'no_pass'],
      ['a pending pass', { status: 'pending' as const }, 'pass_pending'],
      ['an exhausted pass', { remainingSessions: 0 }, 'pass_exhausted'],
      ['an expired pass', { expiresAt: new Date(Date.now() - 60_000) }, 'pass_expired'],
      ['a rejected pass', { status: 'rejected' as const }, 'no_pass'],
    ])('denies access and registers nothing with %s', async (_name, overrides, reason) => {
      await insertRateAndPass(overrides);
      const bookingId = await insertBooking(5);

      const response = await scanAs(staff, await issueCodeAsAna());

      expect(response.statusCode).toBe(200);
      const body = response.json<CheckInBody>();
      expect(body).toMatchObject({ kind: 'client', access: { isGranted: false, reason } });
      expect(body.booking).toBeUndefined();
      expect(await readCheckedInAt(bookingId)).toBeNull();
    });

    it('keeps answering the same arrival when the last session was just used', async () => {
      await insertRateAndPass({ remainingSessions: 1 });
      await insertBooking(5);
      const qrContent = await issueCodeAsAna();

      const first = (await scanAs(staff, qrContent)).json<CheckInBody>();
      const second = (await scanAs(staff, qrContent)).json<CheckInBody>();

      expect(first.isFirstCheckIn).toBe(true);
      expect(second.isFirstCheckIn).toBe(false);
      expect(second.booking?.id).toBe(first.booking?.id);
    });
  });

  describe('one class takes one session off the pass, however many times the QR is scanned', () => {
    async function readRemainingSessions(): Promise<number> {
      const passes = await world.tenantPrismaService.runInTenantContext(ownerActor(), (prisma) =>
        prisma.clientPass.findMany({ where: { clientMembershipId: ana.membershipId } }),
      );
      return passes[0]?.remainingSessions ?? -1;
    }

    it('does not take another session when the teacher already confirmed with the checkbox', async () => {
      await insertRateAndPass({ remainingSessions: 4 });
      const bookingId = await insertBooking(5);
      const confirmation = await world.call(
        'POST',
        `/v1/centers/${centerId}/bookings/${bookingId}/attendance`,
        staff.userId,
        { centerId },
      );
      expect(confirmation.statusCode).toBe(200);
      expect(await readRemainingSessions()).toBe(3);
      const qrContent = await issueCodeAsAna();

      const scans = [];
      for (let attempt = 0; attempt < 6; attempt += 1) {
        scans.push((await scanAs(staff, qrContent)).json<CheckInBody>());
      }

      expect(scans.every((scan) => !scan.isFirstCheckIn)).toBe(true);
      expect(scans.every((scan) => scan.booking?.id === bookingId)).toBe(true);
      expect(scans.every((scan) => scan.access.isGranted)).toBe(true);
      expect(await readRemainingSessions()).toBe(3);
    });

    it('takes a single session when the QR is scanned several times for the same class', async () => {
      await insertRateAndPass({ remainingSessions: 4 });
      await insertBooking(5);
      const qrContent = await issueCodeAsAna();

      for (let attempt = 0; attempt < 6; attempt += 1) {
        await scanAs(staff, qrContent);
      }

      expect(await readRemainingSessions()).toBe(3);
    });
  });

  it('lets a team member in and clocks them with the person block', async () => {
    const issued = await world.call('POST', issueUrl(), otherStaff.userId, { centerId });
    const response = await scanAs(staff, issued.json<CheckInCodeBody>().qrContent);

    expect(response.statusCode).toBe(200);
    expect(response.json<CheckInBody>()).toMatchObject({
      kind: 'staff',
      person: { membershipId: otherStaff.membershipId, role: 'staff' },
      access: { isGranted: true, reason: 'team_member', pass: null },
    });
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

  it('keeps the roles apart: clients cannot scan, and the team issues a QR to clock in', async () => {
    const qrContent = await issueCodeAsAna();

    expect((await scanAs(ana, qrContent)).statusCode).toBe(403);
    expect((await world.call('POST', issueUrl(), staff.userId, { centerId })).statusCode).toBe(200);
  });

  it('answers kind client for a client arrival', async () => {
    await insertBooking(5);

    const response = await scanAs(staff, await issueCodeAsAna());

    expect(response.json<{ kind: string }>().kind).toBe('client');
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
