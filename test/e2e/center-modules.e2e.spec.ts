import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AccessTokenService } from '../../src/shared/auth/access-token.service';
import { PrismaService } from '../../src/shared/database/prisma.service';
import { TenantPrismaService } from '../../src/shared/database/tenant-prisma.service';
import { DatabaseFixtures } from '../support/database-fixtures';
import { resetTestDatabase } from '../support/test-database';
import { createTestApplication } from './create-test-application';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

describe('center modules (lo que un centro apaga, la API lo rechaza)', () => {
  let application: NestFastifyApplication;
  let accessTokenService: AccessTokenService;
  let fixtures: DatabaseFixtures;
  let tenantPrismaService: TenantPrismaService;
  let centerId: string;
  let owner: string;
  let client: string;

  async function call(method: Method, userId: string, path: string, payload: object = {}) {
    const token = (await accessTokenService.issue(userId, { isMfaVerified: true })).token;
    return application.inject({
      method,
      url: `/v1/centers/${centerId}${path}`,
      headers: { authorization: `Bearer ${token}`, 'x-center-id': centerId },
      ...(method === 'GET' ? {} : { payload }),
    });
  }

  async function setDisabledModules(
    disabledModules: string[],
    targetCenterId: string = centerId,
  ): Promise<void> {
    await tenantPrismaService.runInTenantContext(
      {
        userId: owner,
        centerId: targetCenterId,
        membershipId: owner,
        role: 'owner' as const,
        permissions: [],
      },
      (prisma) =>
        prisma.center.update({ where: { id: targetCenterId }, data: { disabledModules } }),
    );
  }

  beforeAll(async () => {
    application = await createTestApplication();
    accessTokenService = application.get(AccessTokenService);
    tenantPrismaService = application.get(TenantPrismaService);
    fixtures = new DatabaseFixtures(application.get(PrismaService), tenantPrismaService);
  });

  beforeEach(async () => {
    await resetTestDatabase();
    centerId = await fixtures.createCenter('taller-norte', 'TALLER');
    owner = await fixtures.createUser('owner');
    client = await fixtures.createUser('client');
    await fixtures.createMembership({ centerId, userId: owner, role: 'owner' });
    await fixtures.createMembership({ centerId, userId: client, role: 'client' });
  });

  afterAll(async () => {
    await application.close();
  });

  it.each([
    ['content', ['content'], 'GET', '/content'],
    ['content (routines)', ['content'], 'GET', '/routines'],
    ['attendance', ['attendance'], 'POST', '/me/checkin-code'],
    ['passes (assign)', ['passes'], 'POST', '/passes/assign'],
    ['passes (new rate)', ['passes'], 'POST', '/rates'],
    ['rooms (new room)', ['rooms'], 'POST', '/rooms'],
    ['rooms (schedules)', ['rooms'], 'GET', '/schedules'],
  ] as const)(
    'answers 409 MODULE_DISABLED on %s when it is off',
    async (_name, off, method, path) => {
      await setDisabledModules([...off]);

      const response = await call(method, owner, path);

      expect(response.statusCode).toBe(409);
      expect(response.json<{ code: string }>().code).toBe('MODULE_DISABLED');
    },
  );

  it('answers 409 MODULE_DISABLED to a client asking for their routines when content is off', async () => {
    await setDisabledModules(['content']);

    const response = await call('GET', client, '/my-routines');

    expect(response.statusCode).toBe(409);
    expect(response.json<{ code: string }>().code).toBe('MODULE_DISABLED');
  });

  it('lets the same routes through while the module is on', async () => {
    const content = await call('GET', owner, '/content');
    const schedules = await call('GET', owner, '/schedules');

    expect(content.statusCode).toBe(200);
    expect(schedules.statusCode).toBe(200);
  });

  it('keeps appointments working with every module off', async () => {
    await setDisabledModules(['content', 'attendance', 'passes', 'waitlist', 'rooms']);

    const services = await call('GET', client, '/services');
    const bookings = await call('GET', client, '/bookings/mine');
    const passes = await call('GET', client, '/passes/mine');
    const rooms = await call('GET', owner, '/rooms');

    expect(services.statusCode).toBe(200);
    expect(bookings.statusCode).toBe(200);
    expect(passes.statusCode).toBe(200);
    expect(rooms.statusCode).toBe(200);
  });

  it('does not tell centers apart by what another center turned off', async () => {
    const otherCenterId = await fixtures.createCenter('otro-taller', 'OTRO77');
    await fixtures.createMembership({ centerId: otherCenterId, userId: owner, role: 'owner' });
    await setDisabledModules(['content'], otherCenterId);

    const response = await call('GET', owner, '/content');

    expect(response.statusCode).toBe(200);
  });
});
