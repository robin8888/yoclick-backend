import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { BookingWorld } from '../support/booking-world';
import { resetTestDatabase } from '../support/test-database';
import { createTestApplication } from './create-test-application';

describe('extra permissions given to a staff member', () => {
  let application: NestFastifyApplication;
  let world: BookingWorld;
  let ownerUserId: string;
  let centerId: string;
  let staff: { userId: string; membershipId: string };
  let client: { userId: string; membershipId: string };

  const call = (method: 'GET' | 'POST' | 'PATCH', path: string, userId: string, body?: object) =>
    world.call(method, `/v1/centers/${centerId}${path}`, userId, {
      centerId,
      ...(body && { body }),
    });

  async function grantPermissions(permissions: string[]): Promise<void> {
    const response = await call('PATCH', `/team/${staff.membershipId}`, ownerUserId, {
      permissions,
    });
    expect(response.statusCode).toBe(200);
  }

  const readReport = () => call('GET', '/reports', staff.userId);
  const updateClientLevel = () =>
    call('PATCH', `/clients/${client.membershipId}`, staff.userId, { level: 'advanced' });
  const createService = () =>
    call('POST', '/services', staff.userId, {
      name: 'Clase extra',
      durationMinutes: 45,
      staffMembershipIds: [staff.membershipId],
    });

  beforeAll(async () => {
    application = await createTestApplication();
    world = new BookingWorld(application);
  });

  beforeEach(async () => {
    await resetTestDatabase();
    ownerUserId = await world.fixtures.createUser('owner');
    centerId = (await world.createCenter(ownerUserId)).centerId;
    staff = await world.addMember(centerId, 'marta', 'staff');
    client = await world.addMember(centerId, 'ana', 'client');
  });

  afterAll(async () => {
    await application.close();
  });

  it('keeps staff out of administration until the center grants a permission', async () => {
    expect((await readReport()).statusCode).toBe(403);
    expect((await updateClientLevel()).statusCode).toBe(403);
    expect((await createService()).statusCode).toBe(403);
  });

  it('lets staff read the reports with reports:view, and nothing else', async () => {
    await grantPermissions(['reports:view']);

    expect((await readReport()).statusCode).toBe(200);
    expect((await updateClientLevel()).statusCode).toBe(403);
    expect((await createService()).statusCode).toBe(403);
  });

  it('lets staff manage clients with clients:manage, and nothing else', async () => {
    await grantPermissions(['clients:manage']);

    expect((await updateClientLevel()).statusCode).toBe(200);
    expect((await call('GET', '/groups', staff.userId)).statusCode).toBe(200);
    expect((await readReport()).statusCode).toBe(403);
  });

  it('lets staff manage services with services:manage', async () => {
    await grantPermissions(['services:manage']);

    expect((await createService()).statusCode).toBe(201);
  });

  it('takes effect as soon as the permission is removed', async () => {
    await grantPermissions(['reports:view']);
    expect((await readReport()).statusCode).toBe(200);

    await grantPermissions([]);

    expect((await readReport()).statusCode).toBe(403);
  });

  it('never opens the administration to a client, whatever is stored in their row', async () => {
    await world.tenantPrismaService.runInTenantContext(
      {
        userId: ownerUserId,
        centerId,
        membershipId: '',
        role: 'owner',
        permissions: [],
      },
      (prisma) =>
        prisma.membership.update({
          where: { id: client.membershipId },
          data: { permissions: ['reports:view', 'clients:manage', 'services:manage'] },
        }),
    );

    const response = await call('GET', '/reports', client.userId);

    expect(response.statusCode).toBe(403);
  });
});
