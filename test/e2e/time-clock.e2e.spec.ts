import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { BookingWorld, type CreatedTestCenter } from '../support/booking-world';
import { resetTestDatabase } from '../support/test-database';
import { createTestApplication } from './create-test-application';

const MILLISECONDS_PER_MINUTE = 60_000;
const MILLISECONDS_PER_HOUR = 60 * MILLISECONDS_PER_MINUTE;

interface Person {
  userId: string;
  membershipId: string;
}

interface TimeEntryBody {
  id: string;
  staffMembershipId: string;
  workDate: string;
  clockInAt: string;
  clockOutAt: string | null;
  isOpen: boolean;
  workedMinutes: number;
  inSource: string;
  outSource: string | null;
  isEdited: boolean;
  originalClockInAt: string | null;
  originalClockOutAt: string | null;
}

interface ScanBody {
  kind: 'client' | 'staff';
  booking?: unknown;
  staff: {
    membershipId: string;
    action: 'clock_in' | 'clock_out';
    workedMinutes: number | null;
    entry: TimeEntryBody;
  };
}

interface ListBody {
  entries: TimeEntryBody[];
  totals: { workedMinutes: number; daysWorked: number; editedCount: number };
}

interface ProblemBody {
  code: string;
}

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * MILLISECONDS_PER_HOUR).toISOString();
}

describe('team time clock (fichaje)', () => {
  let application: NestFastifyApplication;
  let world: BookingWorld;
  let ownerUserId: string;
  let center: CreatedTestCenter;
  let centerId: string;
  let staff: Person;
  let otherStaff: Person;
  let ana: Person;

  const base = (): string => `/v1/centers/${centerId}`;
  const ownerActor = () =>
    ({
      userId: ownerUserId,
      centerId,
      membershipId: center.ownerMembershipId,
      role: 'owner',
      permissions: [],
    }) as const;
  const staffActor = (person: Person) =>
    ({
      userId: person.userId,
      centerId,
      membershipId: person.membershipId,
      role: 'staff',
      permissions: [],
    }) as const;
  const currentMonth = (): string => new Date().toISOString().slice(0, 7);

  async function issueCode(person: Person, inCenterId = centerId): Promise<string> {
    const response = await world.call(
      'POST',
      `/v1/centers/${inCenterId}/me/checkin-code`,
      person.userId,
      {
        centerId: inCenterId,
      },
    );
    expect(response.statusCode).toBe(200);
    return response.json<{ qrContent: string }>().qrContent;
  }

  async function scanAs(scanner: Person, qrContent: string) {
    return world.call('POST', `${base()}/attendance/check-in`, scanner.userId, {
      centerId,
      body: { qrContent },
    });
  }

  async function moveEntryInTime(
    entryId: string,
    changes: { clockInAt?: Date; clockOutAt?: Date },
  ) {
    await world.tenantPrismaService.runInTenantContext(ownerActor(), async (prisma) => {
      await prisma.staffTimeEntry.update({ where: { id: entryId }, data: changes });
    });
  }

  async function createManual(person: Person, clockInAt: string, clockOutAt: string) {
    return world.call('POST', `${base()}/me/time-entries`, person.userId, {
      centerId,
      body: { clockInAt, clockOutAt },
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
    ana = await world.addMember(centerId, 'ana', 'client');
  });

  afterAll(async () => {
    await application.close();
  });

  describe('scanning the QR', () => {
    it('lets the team issue a QR and clocks them in when the owner scans it', async () => {
      const response = await scanAs(
        { userId: ownerUserId, membershipId: center.ownerMembershipId },
        await issueCode(staff),
      );

      expect(response.statusCode).toBe(200);
      const body = response.json<ScanBody>();
      expect(body.kind).toBe('staff');
      expect(body.booking).toBeUndefined();
      expect(body.staff).toMatchObject({
        membershipId: staff.membershipId,
        action: 'clock_in',
        workedMinutes: null,
        entry: { isOpen: true, inSource: 'qr', isEdited: false, clockOutAt: null },
      });
    });

    it('answers the same result without duplicating when the same scan repeats within 30 seconds', async () => {
      const qrContent = await issueCode(staff);
      const first = (await scanAs(otherStaff, qrContent)).json<ScanBody>();

      const second = await scanAs(otherStaff, qrContent);

      expect(second.statusCode).toBe(200);
      expect(second.json<ScanBody>().staff.entry.id).toBe(first.staff.entry.id);
      expect(second.json<ScanBody>().staff.action).toBe('clock_in');
      const listed = await world.call(
        'GET',
        `${base()}/me/time-entries?month=${currentMonth()}`,
        staff.userId,
        {
          centerId,
        },
      );
      expect(listed.json<ListBody>().entries).toHaveLength(1);
    });

    it('alternates: closes the open shift with the worked minutes, then opens a new one', async () => {
      const qrContent = await issueCode(staff);
      const opened = (await scanAs(otherStaff, qrContent)).json<ScanBody>();
      await moveEntryInTime(opened.staff.entry.id, {
        clockInAt: new Date(Date.now() - 4 * MILLISECONDS_PER_HOUR),
      });

      const closed = (await scanAs(otherStaff, qrContent)).json<ScanBody>();

      expect(closed.staff.action).toBe('clock_out');
      expect(closed.staff.entry).toMatchObject({
        id: opened.staff.entry.id,
        isOpen: false,
        outSource: 'qr',
      });
      expect(closed.staff.workedMinutes).toBeGreaterThanOrEqual(239);
      await moveEntryInTime(opened.staff.entry.id, {
        clockInAt: new Date(Date.now() - 6 * MILLISECONDS_PER_HOUR),
        clockOutAt: new Date(Date.now() - 2 * MILLISECONDS_PER_HOUR),
      });

      const reopened = (await scanAs(otherStaff, qrContent)).json<ScanBody>();

      expect(reopened.staff.action).toBe('clock_in');
      expect(reopened.staff.entry.id).not.toBe(opened.staff.entry.id);
    });

    it('discards a shift left open for more than 16 hours and clocks in again', async () => {
      const qrContent = await issueCode(staff);
      const forgotten = (await scanAs(otherStaff, qrContent)).json<ScanBody>();
      await moveEntryInTime(forgotten.staff.entry.id, {
        clockInAt: new Date(Date.now() - 20 * MILLISECONDS_PER_HOUR),
      });

      const response = (await scanAs(otherStaff, qrContent)).json<ScanBody>();

      expect(response.staff.action).toBe('clock_in');
      expect(response.staff.entry.id).not.toBe(forgotten.staff.entry.id);
    });

    it('rejects a code from another center as if it were fake', async () => {
      const otherOwnerUserId = await world.fixtures.createUser('otherowner');
      const otherCenter = await world.createCenter(otherOwnerUserId, 'Otro centro');
      const foreignCode = await world.call(
        'POST',
        `/v1/centers/${otherCenter.centerId}/me/checkin-code`,
        otherOwnerUserId,
        { centerId: otherCenter.centerId },
      );

      const response = await scanAs(
        otherStaff,
        foreignCode.json<{ qrContent: string }>().qrContent,
      );

      expect(response.statusCode).toBe(422);
      expect(response.json<ProblemBody>().code).toBe('CHECKIN_CODE_INVALID');
    });

    it('rejects the code of a team member who left the center', async () => {
      const qrContent = await issueCode(staff);
      await world.tenantPrismaService.runInTenantContext(ownerActor(), async (prisma) => {
        await prisma.membership.update({
          where: { id: staff.membershipId },
          data: { status: 'left' },
        });
      });

      const response = await scanAs(otherStaff, qrContent);

      expect(response.statusCode).toBe(422);
      expect(response.json<ProblemBody>().code).toBe('CHECKIN_CODE_INVALID');
    });

    it('answers the client flow (kind client) without clocking anything', async () => {
      const qrContent = await issueCode(ana);

      const response = await scanAs(staff, qrContent);

      expect(response.statusCode).toBe(200);
      expect(response.json<{ kind: string; person: { role: string } }>()).toMatchObject({
        kind: 'client',
        person: { role: 'client' },
      });
    });
  });

  describe('visibility (RLS and roles)', () => {
    async function clockIn(person: Person): Promise<TimeEntryBody> {
      const owner = { userId: ownerUserId, membershipId: center.ownerMembershipId };
      const response = await scanAs(owner, await issueCode(person));
      return response.json<ScanBody>().staff.entry;
    }

    async function closeShift(entry: TimeEntryBody): Promise<void> {
      await moveEntryInTime(entry.id, {
        clockInAt: new Date(Date.now() - 3 * MILLISECONDS_PER_HOUR),
        clockOutAt: new Date(Date.now() - 1 * MILLISECONDS_PER_HOUR),
      });
    }

    it('shows each person only their own entries, and the owner any of them', async () => {
      const staffEntry = await clockIn(staff);
      await closeShift(staffEntry);
      const otherEntry = await clockIn(otherStaff);
      await closeShift(otherEntry);
      const url = `${base()}/me/time-entries?month=${currentMonth()}`;

      const ownList = await world.call('GET', url, otherStaff.userId, { centerId });
      const forbidden = await world.call(
        'GET',
        `${url}&staffMembershipId=${staff.membershipId}`,
        otherStaff.userId,
        {
          centerId,
        },
      );
      const byOwner = await world.call(
        'GET',
        `${url}&staffMembershipId=${staff.membershipId}`,
        ownerUserId,
        {
          centerId,
        },
      );

      expect(ownList.json<ListBody>().entries.map((entry) => entry.id)).toEqual([otherEntry.id]);
      expect(forbidden.statusCode).toBe(403);
      expect(byOwner.json<ListBody>().entries.map((entry) => entry.id)).toEqual([staffEntry.id]);
      expect(byOwner.json<ListBody>().totals.workedMinutes).toBe(120);
    });

    it('hides the closed entries of another person from staff at the database level', async () => {
      const staffEntry = await clockIn(staff);
      await closeShift(staffEntry);

      const visible = await world.tenantPrismaService.runInTenantContext(
        staffActor(otherStaff),
        async (prisma) => prisma.staffTimeEntry.findMany(),
      );
      const visibleToOwner = await world.tenantPrismaService.runInTenantContext(
        ownerActor(),
        async (prisma) => prisma.staffTimeEntry.findMany(),
      );

      expect(visible).toHaveLength(0);
      expect(visibleToOwner).toHaveLength(1);
    });

    it('does not let clients use the endpoints', async () => {
      const response = await world.call(
        'GET',
        `${base()}/me/time-entries?month=${currentMonth()}`,
        ana.userId,
        {
          centerId,
        },
      );

      expect(response.statusCode).toBe(403);
    });

    it('rejects a malformed month', async () => {
      const response = await world.call(
        'GET',
        `${base()}/me/time-entries?month=2026-13`,
        staff.userId,
        {
          centerId,
        },
      );

      expect(response.statusCode).toBe(400);
    });
  });

  describe('manual entries and edits', () => {
    it('adds a forgotten day marked as edited, without originals, and derives the local work date', async () => {
      // 23:30 UTC del 12 de enero son las 00:30 del 13 en Madrid: cuenta en el día 13.
      const response = await createManual(
        staff,
        '2026-01-12T23:30:00.000Z',
        '2026-01-13T05:30:00.000Z',
      );

      expect(response.statusCode).toBe(201);
      expect(response.json<TimeEntryBody>()).toMatchObject({
        workDate: '2026-01-13',
        workedMinutes: 360,
        inSource: 'manual',
        outSource: 'manual',
        isEdited: true,
        originalClockInAt: null,
        originalClockOutAt: null,
      });
    });

    it.each([
      ['out before in', hoursAgo(5), hoursAgo(6), 'TIME_ENTRY_INVALID_RANGE'],
      ['longer than 16 hours', hoursAgo(40), hoursAgo(10), 'TIME_ENTRY_TOO_LONG'],
      ['in the future', hoursAgo(-1), hoursAgo(-3), 'TIME_ENTRY_IN_FUTURE'],
    ])('rejects a manual entry %s', async (_name, clockInAt, clockOutAt, expectedCode) => {
      const response = await createManual(staff, clockInAt, clockOutAt);

      expect(response.statusCode).toBe(422);
      expect(response.json<ProblemBody>().code).toBe(expectedCode);
    });

    it('rejects an entry that overlaps another one of the same person with 409', async () => {
      await createManual(staff, hoursAgo(10), hoursAgo(6));

      const overlapping = await createManual(staff, hoursAgo(8), hoursAgo(4));
      const adjacent = await createManual(staff, hoursAgo(6), hoursAgo(4));
      const otherPerson = await createManual(otherStaff, hoursAgo(8), hoursAgo(4));

      expect(overlapping.statusCode).toBe(409);
      expect(overlapping.json<ProblemBody>().code).toBe('TIME_ENTRY_OVERLAP');
      expect(adjacent.statusCode).toBe(201);
      expect(otherPerson.statusCode).toBe(201);
    });

    it('keeps the original hours of the first edit only, and records who and when', async () => {
      const created = (await createManual(staff, hoursAgo(10), hoursAgo(6))).json<TimeEntryBody>();
      const scanned = (await scanAs(otherStaff, await issueCode(staff))).json<ScanBody>().staff
        .entry;
      await moveEntryInTime(scanned.id, {
        clockInAt: new Date(Date.now() - 3 * MILLISECONDS_PER_HOUR),
      });
      const url = `${base()}/me/time-entries/${scanned.id}`;
      const closeAt = hoursAgo(1);

      const first = await world.call('PATCH', url, staff.userId, {
        centerId,
        body: { clockOutAt: closeAt },
      });
      const secondAt = hoursAgo(2);
      const second = await world.call('PATCH', url, staff.userId, {
        centerId,
        body: { clockOutAt: secondAt },
      });

      expect(created.isEdited).toBe(true);
      expect(first.statusCode).toBe(200);
      expect(first.json<TimeEntryBody>()).toMatchObject({
        isOpen: false,
        isEdited: true,
        originalClockOutAt: null,
        originalClockInAt: expect.any(String),
      });
      expect(second.json<TimeEntryBody>()).toMatchObject({
        clockOutAt: secondAt,
        originalClockInAt: first.json<TimeEntryBody>().originalClockInAt,
        originalClockOutAt: null,
      });
    });

    it('stores the previous hours as originals when a closed entry is edited, and recomputes the work date', async () => {
      const created = (
        await createManual(staff, '2026-02-10T08:00:00.000Z', '2026-02-10T12:00:00.000Z')
      ).json<TimeEntryBody>();
      const scannedEntry = await world.tenantPrismaService.runInTenantContext(
        ownerActor(),
        async (prisma) =>
          prisma.staffTimeEntry.update({ where: { id: created.id }, data: { isEdited: false } }),
      );
      expect(scannedEntry.isEdited).toBe(false);

      const response = await world.call(
        'PATCH',
        `${base()}/me/time-entries/${created.id}`,
        staff.userId,
        {
          centerId,
          body: { clockInAt: '2026-02-10T23:30:00.000Z', clockOutAt: '2026-02-11T03:30:00.000Z' },
        },
      );

      expect(response.json<TimeEntryBody>()).toMatchObject({
        workDate: '2026-02-11',
        isEdited: true,
        originalClockInAt: '2026-02-10T08:00:00.000Z',
        originalClockOutAt: '2026-02-10T12:00:00.000Z',
      });
    });

    it('lets staff edit and delete only their own entries; owner and admin any', async () => {
      const own = (await createManual(staff, hoursAgo(10), hoursAgo(6))).json<TimeEntryBody>();
      const url = `${base()}/me/time-entries/${own.id}`;
      const body = { clockOutAt: hoursAgo(7) };

      const byOther = await world.call('PATCH', url, otherStaff.userId, { centerId, body });
      const deleteByOther = await world.call('DELETE', url, otherStaff.userId, { centerId });
      const byOwner = await world.call('PATCH', url, ownerUserId, { centerId, body });
      const deleted = await world.call('DELETE', url, staff.userId, { centerId });
      const deletedAgain = await world.call('DELETE', url, staff.userId, { centerId });
      const listed = await world.call(
        'GET',
        `${base()}/me/time-entries?month=${currentMonth()}`,
        staff.userId,
        {
          centerId,
        },
      );

      expect(byOther.statusCode).toBe(404);
      expect(deleteByOther.statusCode).toBe(404);
      expect(byOwner.statusCode).toBe(200);
      expect(deleted.statusCode).toBe(204);
      expect(deletedAgain.statusCode).toBe(404);
      expect(listed.json<ListBody>().entries.map((entry) => entry.id)).not.toContain(own.id);
    });

    it('rejects a body with no fields and unknown fields', async () => {
      const own = (await createManual(staff, hoursAgo(10), hoursAgo(6))).json<TimeEntryBody>();
      const url = `${base()}/me/time-entries/${own.id}`;

      const empty = await world.call('PATCH', url, staff.userId, { centerId, body: {} });
      const unknown = await world.call('PATCH', url, staff.userId, {
        centerId,
        body: { clockOutAt: hoursAgo(7), isEdited: false },
      });

      expect(empty.statusCode).toBe(400);
      expect(unknown.statusCode).toBe(400);
    });

    it('totals the month with minutes, days and edited entries', async () => {
      await createManual(staff, hoursAgo(30), hoursAgo(26));
      await createManual(staff, hoursAgo(10), hoursAgo(8));
      const months = new Set([hoursAgo(30), hoursAgo(8)].map((iso) => iso.slice(0, 7)));

      const lists = await Promise.all(
        [...months].map((month) =>
          world.call('GET', `${base()}/me/time-entries?month=${month}`, staff.userId, { centerId }),
        ),
      );

      const totals = lists.map((list) => list.json<ListBody>().totals);
      expect(totals.reduce((sum, entry) => sum + entry.workedMinutes, 0)).toBe(360);
      expect(totals.reduce((sum, entry) => sum + entry.editedCount, 0)).toBe(2);
    });
  });
});
