import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { BookingWorld, type CreatedTestCenter } from '../support/booking-world';
import { resetTestDatabase } from '../support/test-database';
import { createTestApplication } from './create-test-application';

interface JoinStatsBody {
  month: string;
  qr: number;
  link: number;
  code: number;
  search: number;
  total: number;
}

describe('inviting clients: join stats and the join code of the center', () => {
  let application: NestFastifyApplication;
  let world: BookingWorld;
  let owner: string;
  let center: CreatedTestCenter;

  const statsUrl = (): string => `/v1/centers/${center.centerId}/join-stats`;
  const regenerateUrl = (): string => `/v1/centers/${center.centerId}/join-code/regenerate`;

  async function joinWith(source: string | undefined, name: string): Promise<void> {
    const userId = await world.fixtures.createUser(name);
    const response = await world.call('POST', `/v1/join/${center.centerId}`, userId, {
      body: { joinCode: center.joinCode, ...(source === undefined ? {} : { source }) },
    });
    if (response.statusCode !== 201) throw new Error(`Join failed: ${response.body}`);
  }

  beforeAll(async () => {
    application = await createTestApplication();
    world = new BookingWorld(application);
  });

  beforeEach(async () => {
    await resetTestDatabase();
    owner = await world.fixtures.createUser('owner');
    center = await world.createCenter(owner);
  });

  afterAll(async () => {
    await application.close();
  });

  it('counts this month joins by where they came from', async () => {
    await joinWith('qr', 'ana');
    await joinWith('qr', 'ben');
    await joinWith('link', 'cris');
    await joinWith('code', 'dani');
    await joinWith('search', 'eva');
    await joinWith(undefined, 'fran');

    const response = await world.call('GET', statsUrl(), owner, { centerId: center.centerId });

    expect(response.statusCode).toBe(200);
    expect(response.json<JoinStatsBody>()).toMatchObject({
      qr: 2,
      link: 1,
      code: 1,
      search: 1,
      total: 6,
    });
    expect(response.json<JoinStatsBody>().month).toMatch(/^\d{4}-\d{2}$/);
  });

  it('changes the join code: the old one stops working and members keep their place', async () => {
    await joinWith('code', 'ana');

    const response = await world.call('POST', regenerateUrl(), owner, {
      centerId: center.centerId,
    });

    expect(response.statusCode).toBe(200);
    const { joinCode } = response.json<{ joinCode: string }>();
    expect(joinCode).toMatch(/^[A-Z2-9]{6}$/);
    expect(joinCode).not.toBe(center.joinCode);
    const oldCode = await world.call('GET', `/v1/join/code/${center.joinCode}`, undefined);
    const newCode = await world.call('GET', `/v1/join/code/${joinCode}`, undefined);
    expect(oldCode.statusCode).toBe(404);
    expect(newCode.statusCode).toBe(200);
    const stats = await world.call('GET', statsUrl(), owner, { centerId: center.centerId });
    expect(stats.json<JoinStatsBody>().total).toBe(1);
  });

  it('is only for administration and needs the second factor', async () => {
    const client = await world.addMember(center.centerId, 'ana', 'client');
    const asClient = await world.call('GET', statsUrl(), client.userId, {
      centerId: center.centerId,
    });
    const withoutSecondFactor = await world.call('POST', regenerateUrl(), owner, {
      centerId: center.centerId,
      isMfaVerified: false,
    });

    expect(asClient.statusCode).toBe(403);
    expect(withoutSecondFactor.json<{ code: string }>().code).toBe('MFA_REQUIRED');
  });
});
