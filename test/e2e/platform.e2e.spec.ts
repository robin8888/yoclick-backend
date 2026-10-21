import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { BookingWorld } from '../support/booking-world';
import { grantPlatformRoleAsOwner, resetTestDatabase } from '../support/test-database';
import { createTestApplication } from './create-test-application';

interface CenterRow {
  id: string;
  name: string;
  status: string;
  activeClientCount: number;
  teamMemberCount: number;
  maxClients: number | null;
}

interface CenterPage {
  data: CenterRow[];
  nextCursor: string | null;
}

interface Overview {
  centers: {
    total: number;
    byStatus: Record<string, number>;
    newLast30Days: number;
    trialsEndingWithin7Days: number;
  };
  people: { activeClients: number; activeTeamMembers: number };
  monthly: { newCenters: { month: string; count: number }[] };
}

interface AuditPage {
  data: { action: string; centerId: string | null; details: Record<string, unknown> }[];
}

const MILLISECONDS_PER_DAY = 86_400_000;

describe('platform administration', () => {
  let application: NestFastifyApplication;
  let world: BookingWorld;
  let adminUserId: string;
  let firstCenterId: string;
  let secondCenterId: string;

  const asAdmin = (method: 'GET' | 'PATCH', url: string, body?: object) =>
    world.call(method, url, adminUserId, body === undefined ? {} : { body });

  beforeAll(async () => {
    application = await createTestApplication();
    world = new BookingWorld(application);
  });

  beforeEach(async () => {
    await resetTestDatabase();
    adminUserId = await world.fixtures.createUser('platform-admin');
    await grantPlatformRoleAsOwner(adminUserId, 'admin');
    const firstOwner = await world.fixtures.createUser('first-owner');
    const secondOwner = await world.fixtures.createUser('second-owner');
    firstCenterId = (await world.createCenter(firstOwner, 'Primer Centro')).centerId;
    secondCenterId = (await world.createCenter(secondOwner, 'Segundo Dojo')).centerId;
    await world.addMember(firstCenterId, 'ana', 'client');
    await world.addMember(firstCenterId, 'bruno', 'client');
    await world.addMember(secondCenterId, 'carla', 'client');
  });

  afterAll(async () => {
    await application.close();
  });

  describe('who may call it', () => {
    it('needs a session', async () => {
      const response = await world.call('GET', '/v1/platform/overview', undefined);

      expect(response.statusCode).toBe(401);
    });

    it('answers as if it did not exist to a person without a platform role', async () => {
      const ordinaryUser = await world.fixtures.createUser('ordinary');

      const response = await world.call('GET', '/v1/platform/overview', ordinaryUser);

      expect(response.statusCode).toBe(404);
    });

    it('requires the second factor even for the platform admin', async () => {
      const response = await world.call('GET', '/v1/platform/overview', adminUserId, {
        isMfaVerified: false,
      });

      expect(response.statusCode).toBe(403);
      expect(response.json<{ code: string }>().code).toBe('MFA_REQUIRED');
    });

    it('keeps the accountant out of the administration', async () => {
      const accountantUserId = await world.fixtures.createUser('accountant');
      await grantPlatformRoleAsOwner(accountantUserId, 'accountant');

      const response = await world.call('GET', '/v1/platform/overview', accountantUserId);

      expect(response.statusCode).toBe(403);
    });

    it('cannot be granted through the API: the database refuses it', async () => {
      const ordinaryUser = await world.fixtures.createUser('sneaky');

      await expect(
        world.tenantPrismaService.runInUserContext(ordinaryUser, (client) =>
          client.user.update({ where: { id: ordinaryUser }, data: { platformRole: 'admin' } }),
        ),
      ).rejects.toThrow();
    });

    it('stops working as soon as the role is taken away', async () => {
      expect((await asAdmin('GET', '/v1/platform/overview')).statusCode).toBe(200);

      await grantPlatformRoleAsOwner(adminUserId, 'accountant');

      expect((await asAdmin('GET', '/v1/platform/overview')).statusCode).toBe(403);
    });
  });

  describe('GET /platform/overview', () => {
    it('counts centers, clients and team across every center', async () => {
      const response = await asAdmin('GET', '/v1/platform/overview');

      expect(response.statusCode).toBe(200);
      const overview = response.json<Overview>();
      expect(overview.centers.total).toBe(2);
      expect(overview.centers.byStatus).toMatchObject({ trial: 2, active: 0 });
      expect(overview.centers.newLast30Days).toBe(2);
      expect(overview.people.activeClients).toBe(3);
      expect(overview.people.activeTeamMembers).toBe(2);
      expect(overview.monthly.newCenters).toHaveLength(12);
      expect(overview.monthly.newCenters.at(-1)?.count).toBe(2);
    });

    it('never carries personal data of the people behind the numbers', async () => {
      const response = await asAdmin('GET', '/v1/platform/overview');

      expect(response.body).not.toMatch(/@|first-owner|second-owner|ana|bruno|carla/i);
    });
  });

  describe('GET /platform/centers', () => {
    it('lists every center with its usage figures', async () => {
      const response = await asAdmin('GET', '/v1/platform/centers');

      const centers = response.json<CenterPage>().data;
      expect(
        centers.map(({ name }) => name).sort((first, second) => first.localeCompare(second)),
      ).toEqual(['Primer Centro', 'Segundo Dojo']);
      const first = centers.find(({ id }) => id === firstCenterId);
      expect(first).toMatchObject({ activeClientCount: 2, teamMemberCount: 1, status: 'trial' });
    });

    it('filters by status and by name', async () => {
      await asAdmin('PATCH', `/v1/platform/centers/${secondCenterId}`, { status: 'suspended' });

      const suspended = await asAdmin('GET', '/v1/platform/centers?status=suspended');
      const byName = await asAdmin('GET', '/v1/platform/centers?search=primer');

      expect(suspended.json<CenterPage>().data.map(({ id }) => id)).toEqual([secondCenterId]);
      expect(byName.json<CenterPage>().data.map(({ id }) => id)).toEqual([firstCenterId]);
    });

    it('pages through the centers without repeating any', async () => {
      const firstPage = await asAdmin('GET', '/v1/platform/centers?limit=1');
      const { nextCursor } = firstPage.json<CenterPage>();
      const secondPage = await asAdmin(
        'GET',
        `/v1/platform/centers?limit=1&cursor=${encodeURIComponent(nextCursor ?? '')}`,
      );

      const ids = [...firstPage.json<CenterPage>().data, ...secondPage.json<CenterPage>().data].map(
        ({ id }) => id,
      );
      expect(nextCursor).not.toBeNull();
      expect(new Set(ids).size).toBe(2);
      expect(secondPage.json<CenterPage>().nextCursor).toBeNull();
    });

    it('rejects a filter it does not know', async () => {
      const response = await asAdmin('GET', '/v1/platform/centers?plan=pro');

      expect(response.statusCode).toBe(400);
    });
  });

  describe('PATCH /platform/centers/:centerId', () => {
    it('suspends a center, extends its trial and caps its clients, leaving a trace of each', async () => {
      const trialEndsAt = new Date(Date.now() + 30 * MILLISECONDS_PER_DAY).toISOString();

      const response = await asAdmin('PATCH', `/v1/platform/centers/${firstCenterId}`, {
        status: 'suspended',
        trialEndsAt,
        maxClients: 150,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json<CenterRow>()).toMatchObject({ status: 'suspended', maxClients: 150 });
      const audit = await asAdmin('GET', `/v1/platform/audit-log?centerId=${firstCenterId}`);
      expect(
        audit
          .json<AuditPage>()
          .data.map(({ action }) => action)
          .sort((first, second) => first.localeCompare(second)),
      ).toEqual(['center_status_changed', 'max_clients_changed', 'trial_changed']);
    });

    it('does not leave a trace when nothing really changes', async () => {
      await asAdmin('PATCH', `/v1/platform/centers/${firstCenterId}`, { status: 'trial' });

      const audit = await asAdmin('GET', '/v1/platform/audit-log');

      expect(audit.json<AuditPage>().data).toEqual([]);
    });

    it('refuses to put the end of the trial in the past', async () => {
      const response = await asAdmin('PATCH', `/v1/platform/centers/${firstCenterId}`, {
        trialEndsAt: new Date(Date.now() - MILLISECONDS_PER_DAY).toISOString(),
      });

      expect(response.statusCode).toBe(400);
    });

    it('needs at least one field and refuses unknown ones', async () => {
      const empty = await asAdmin('PATCH', `/v1/platform/centers/${firstCenterId}`, {});
      const unknown = await asAdmin('PATCH', `/v1/platform/centers/${firstCenterId}`, {
        name: 'Otro nombre',
      });

      expect(empty.statusCode).toBe(400);
      expect(unknown.statusCode).toBe(400);
    });

    it('answers 404 for a center that does not exist', async () => {
      const response = await asAdmin(
        'PATCH',
        '/v1/platform/centers/0191d6a0-0000-7000-8000-000000000999',
        { status: 'active' },
      );

      expect(response.statusCode).toBe(404);
    });
  });

  describe('an ordinary center is not affected', () => {
    it('keeps its owner away from the other centers', async () => {
      const ownerOfSecond = await world.fixtures.createUser('other-owner');
      const secondCenter = (await world.createCenter(ownerOfSecond, 'Tercero')).centerId;

      const response = await world.call('GET', `/v1/centers/${firstCenterId}`, ownerOfSecond, {
        centerId: secondCenter,
      });

      // Un centro ajeno responde igual que uno inexistente: no se revela cuáles hay.
      expect(response.statusCode).toBe(404);
    });
  });
});
