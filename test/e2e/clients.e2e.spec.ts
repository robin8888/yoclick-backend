import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { v7 as generateUuidV7 } from 'uuid';
import { BookingWorld, type CreatedTestCenter } from '../support/booking-world';
import { resetTestDatabase } from '../support/test-database';
import { createTestApplication } from './create-test-application';

const MILLISECONDS_PER_DAY = 86_400_000;
const daysFromNow = (dayCount: number): Date =>
  new Date(Date.now() + dayCount * MILLISECONDS_PER_DAY);

interface ClientBody {
  membershipId: string;
  fullName: string;
  status: string;
  activity: string;
  level: string | null;
  group: { id: string; name: string } | null;
  bookingCount: number;
  nextBookingAt: string | null;
}

interface ClientListBody {
  totalClientCount: number;
  matchingCount: number;
  clients: ClientBody[];
}

interface GroupBody {
  id: string;
  name: string;
  level: string | null;
  instructor: { membershipId: string; fullName: string } | null;
  memberCount: number;
}

describe('clients and groups', () => {
  let application: NestFastifyApplication;
  let world: BookingWorld;
  let owner: string;
  let center: CreatedTestCenter;
  let staff: { userId: string; membershipId: string };
  let ana: { userId: string; membershipId: string };
  let bruno: { userId: string; membershipId: string };
  let serviceId: string;

  const clientsUrl = (path = ''): string => `/v1/centers/${center.centerId}/clients${path}`;
  const groupsUrl = (path = ''): string => `/v1/centers/${center.centerId}/groups${path}`;
  const ownerActor = () =>
    ({
      userId: owner,
      centerId: center.centerId,
      membershipId: center.ownerMembershipId,
      role: 'owner',
      permissions: [],
    }) as const;

  async function listClients(query = '', userId = owner): Promise<ClientListBody> {
    const response = await world.call('GET', clientsUrl(query), userId, {
      centerId: center.centerId,
    });
    return response.json<ClientListBody>();
  }

  const namesOf = (list: ClientListBody): string[] => list.clients.map(({ fullName }) => fullName);

  async function insertBooking(clientMembershipId: string, startsAt: Date): Promise<void> {
    const sessionId = generateUuidV7();
    await world.tenantPrismaService.runInTenantContext(ownerActor(), async (prisma) => {
      await prisma.classSession.create({
        data: {
          id: sessionId,
          centerId: center.centerId,
          serviceId,
          staffMembershipId: staff.membershipId,
          startsAt,
          endsAt: new Date(startsAt.getTime() + 3_600_000),
        },
      });
      await prisma.booking.create({
        data: {
          id: generateUuidV7(),
          centerId: center.centerId,
          classSessionId: sessionId,
          clientMembershipId,
        },
      });
    });
  }

  async function setJoinedDaysAgo(membershipId: string, dayCount: number): Promise<void> {
    await world.tenantPrismaService.runInTenantContext(ownerActor(), (prisma) =>
      prisma.membership.update({
        where: { id: membershipId },
        data: { joinedAt: daysFromNow(-dayCount) },
      }),
    );
  }

  beforeAll(async () => {
    application = await createTestApplication();
    world = new BookingWorld(application);
  });

  beforeEach(async () => {
    await resetTestDatabase();
    owner = await world.fixtures.createUser('owner');
    center = await world.createCenter(owner);
    staff = await world.addMember(center.centerId, 'staff', 'staff');
    ana = await world.addMember(center.centerId, 'ana', 'client');
    bruno = await world.addMember(center.centerId, 'bruno', 'client');
    await world.addMember(center.centerId, 'carla', 'client');
    serviceId = (
      await world.createService(owner, center.centerId, {
        name: 'Sesión',
        durationMinutes: 60,
        staffMembershipIds: [staff.membershipId],
      })
    ).id;
    // Ana: antigua con una cita reciente (activa). Bruno: antiguo sin citas (inactivo). Carla: nueva.
    await setJoinedDaysAgo(ana.membershipId, 90);
    await setJoinedDaysAgo(bruno.membershipId, 90);
    await insertBooking(ana.membershipId, daysFromNow(-2));
  });

  afterAll(async () => {
    await application.close();
  });

  describe('GET /clients', () => {
    it('lists the clients by name with how each one is doing', async () => {
      const list = await listClients();

      expect(namesOf(list)).toEqual(['ana', 'bruno', 'carla']);
      expect(list.totalClientCount).toBe(3);
      expect(list.matchingCount).toBe(3);
      expect(list.clients.map(({ activity }) => activity)).toEqual(['active', 'inactive', 'new']);
      expect(list.clients[0]).toMatchObject({ bookingCount: 1, level: null, group: null });
    });

    it('searches by name or by email, ignoring case', async () => {
      expect(namesOf(await listClients('?search=BRU'))).toEqual(['bruno']);
      expect(namesOf(await listClients('?search=carla%40'))).toEqual(['carla']);
      expect((await listClients('?search=zzz')).matchingCount).toBe(0);
    });

    it.each([
      ['active', ['ana']],
      ['inactive', ['bruno']],
      ['new', ['carla']],
    ])('filters by the %s status and keeps the total', async (status, expectedNames) => {
      const list = await listClients(`?status=${status}`);

      expect(namesOf(list)).toEqual(expectedNames);
      expect(list.totalClientCount).toBe(3);
    });

    it('lists blocked clients apart from the active ones', async () => {
      const dario = await world.fixtures.createUser('dario');
      await world.fixtures.createMembership({
        centerId: center.centerId,
        userId: dario,
        role: 'client',
        status: 'blocked',
      });

      expect(namesOf(await listClients('?status=blocked'))).toEqual(['dario']);
      expect((await listClients('?status=new')).clients.map(({ fullName }) => fullName)).toEqual([
        'carla',
      ]);
    });

    it('does not list the team, people who left or invitations', async () => {
      const left = await world.fixtures.createUser('left');
      await world.fixtures.createMembership({
        centerId: center.centerId,
        userId: left,
        role: 'client',
        status: 'left',
      });

      expect(namesOf(await listClients())).toEqual(['ana', 'bruno', 'carla']);
    });

    it('pages with limit and offset and reports how many match', async () => {
      const firstPage = await listClients('?limit=2');
      const secondPage = await listClients('?limit=2&offset=2');

      expect(namesOf(firstPage)).toEqual(['ana', 'bruno']);
      expect(firstPage.matchingCount).toBe(3);
      expect(namesOf(secondPage)).toEqual(['carla']);
    });

    it.each([['limit=0'], ['limit=101'], ['offset=-1'], ['status=gone'], ['extra=1']])(
      'rejects the query %s',
      async (query) => {
        const response = await world.call('GET', clientsUrl(`?${query}`), owner, {
          centerId: center.centerId,
        });

        expect(response.statusCode).toBe(400);
      },
    );

    it('lets a professional see only the people who booked with them, with their own counts', async () => {
      await insertBooking(ana.membershipId, daysFromNow(3));
      const otherStaff = await world.addMember(center.centerId, 'otherstaff', 'staff');

      const mine = await listClients('', staff.userId);
      const others = await listClients('', otherStaff.userId);

      expect(namesOf(mine)).toEqual(['ana']);
      expect(mine.totalClientCount).toBe(1);
      expect(mine.clients[0]).toMatchObject({ bookingCount: 2 });
      expect(mine.clients[0]?.nextBookingAt).not.toBeNull();
      expect(others.clients).toEqual([]);
    });

    it('is closed to clients and needs the second factor for administration', async () => {
      const asClient = await world.call('GET', clientsUrl(), ana.userId, {
        centerId: center.centerId,
      });
      const withoutSecondFactor = await world.call('GET', clientsUrl(), owner, {
        centerId: center.centerId,
        isMfaVerified: false,
      });

      expect(asClient.statusCode).toBe(403);
      expect(withoutSecondFactor.json<{ code: string }>().code).toBe('MFA_REQUIRED');
    });

    it('never shows the clients of another center', async () => {
      const otherOwner = await world.fixtures.createUser('otherowner');
      const otherCenter = await world.createCenter(otherOwner, 'Otro centro');

      const response = await world.call(
        'GET',
        `/v1/centers/${otherCenter.centerId}/clients`,
        otherOwner,
        { centerId: otherCenter.centerId },
      );

      expect(response.json<ClientListBody>().clients).toEqual([]);
    });
  });

  describe('GET /clients/:membershipId', () => {
    it('returns one client and answers 404 for the team or for unknown people', async () => {
      const found = await world.call('GET', clientsUrl(`/${ana.membershipId}`), owner, {
        centerId: center.centerId,
      });
      const team = await world.call('GET', clientsUrl(`/${staff.membershipId}`), owner, {
        centerId: center.centerId,
      });

      expect(found.json<ClientBody>()).toMatchObject({ fullName: 'ana', activity: 'active' });
      expect(team.statusCode).toBe(404);
    });
  });

  describe('groups and levels', () => {
    const createGroup = (body: object) =>
      world.call('POST', groupsUrl(), owner, { centerId: center.centerId, body });

    const updateClient = (membershipId: string, body: object) =>
      world.call('PATCH', clientsUrl(`/${membershipId}`), owner, {
        centerId: center.centerId,
        body,
      });

    it('creates a group with its level and instructor and lists it', async () => {
      const created = await createGroup({
        name: 'Grupo mañanas',
        level: 'intermediate',
        instructorMembershipId: staff.membershipId,
      });

      expect(created.statusCode).toBe(201);
      expect(created.json<GroupBody>()).toMatchObject({
        name: 'Grupo mañanas',
        level: 'intermediate',
        instructor: { membershipId: staff.membershipId, fullName: 'staff' },
        memberCount: 0,
      });
      const list = await world.call('GET', groupsUrl(), owner, { centerId: center.centerId });
      expect(list.json<{ groups: GroupBody[] }>().groups).toHaveLength(1);
    });

    it('refuses a repeated name, an instructor outside the team and bad input', async () => {
      await createGroup({ name: 'Grupo A' });

      expect((await createGroup({ name: 'grupo a' })).statusCode).toBe(409);
      expect(
        (await createGroup({ name: 'B', instructorMembershipId: ana.membershipId })).statusCode,
      ).toBe(400);
      expect((await createGroup({ name: '   ' })).statusCode).toBe(400);
      expect((await createGroup({ name: 'C', level: 'expert' })).statusCode).toBe(400);
    });

    it('puts a client in a group and sets their level, then takes them out with null', async () => {
      const group = (await createGroup({ name: 'Grupo A' })).json<GroupBody>();

      const assigned = await updateClient(ana.membershipId, {
        level: 'advanced',
        groupId: group.id,
      });

      expect(assigned.statusCode).toBe(200);
      expect(assigned.json<ClientBody>()).toMatchObject({
        level: 'advanced',
        group: { id: group.id, name: 'Grupo A' },
      });
      const groups = await world.call('GET', groupsUrl(), owner, { centerId: center.centerId });
      expect(groups.json<{ groups: GroupBody[] }>().groups[0]?.memberCount).toBe(1);
      const cleared = await updateClient(ana.membershipId, { level: null, groupId: null });
      expect(cleared.json<ClientBody>()).toMatchObject({ level: null, group: null });
    });

    it('rejects an unknown group or a person who is not a client', async () => {
      expect((await updateClient(ana.membershipId, { groupId: generateUuidV7() })).statusCode).toBe(
        400,
      );
      expect((await updateClient(staff.membershipId, { level: 'beginner' })).statusCode).toBe(404);
      expect((await updateClient(ana.membershipId, {})).statusCode).toBe(400);
    });

    it('lists only the people of a group', async () => {
      const group = (await createGroup({ name: 'Grupo A' })).json<GroupBody>();
      await updateClient(bruno.membershipId, { groupId: group.id });

      expect(namesOf(await listClients(`?groupId=${group.id}`))).toEqual(['bruno']);
    });

    it('removes a group, takes its clients out and frees the name', async () => {
      const group = (await createGroup({ name: 'Grupo A' })).json<GroupBody>();
      await updateClient(ana.membershipId, { groupId: group.id });

      const removed = await world.call('DELETE', groupsUrl(`/${group.id}`), owner, {
        centerId: center.centerId,
      });

      expect(removed.statusCode).toBe(204);
      expect((await listClients()).clients[0]?.group).toBeNull();
      expect((await createGroup({ name: 'Grupo A' })).statusCode).toBe(201);
      const again = await world.call('DELETE', groupsUrl(`/${group.id}`), owner, {
        centerId: center.centerId,
      });
      expect(again.statusCode).toBe(404);
    });
  });
});
