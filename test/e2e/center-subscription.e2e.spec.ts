import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { BookingWorld } from '../support/booking-world';
import { resetTestDatabase } from '../support/test-database';
import { createTestApplication } from './create-test-application';

interface SubscriptionBody {
  status: string;
  trialEndsAt: string | null;
  maxClients: number | null;
  activeClientCount: number;
}

describe('GET /centers/:centerId/subscription', () => {
  let application: NestFastifyApplication;
  let world: BookingWorld;
  let ownerUserId: string;
  let centerId: string;

  const getSubscription = (userId: string) =>
    world.call('GET', `/v1/centers/${centerId}/subscription`, userId, { centerId });

  beforeAll(async () => {
    application = await createTestApplication();
    world = new BookingWorld(application);
  });

  beforeEach(async () => {
    await resetTestDatabase();
    ownerUserId = await world.fixtures.createUser('owner');
    centerId = (await world.createCenter(ownerUserId)).centerId;
  });

  afterAll(async () => {
    await application.close();
  });

  it('tells the plan status, the trial end and how many active clients there are', async () => {
    await world.addMember(centerId, 'ana', 'client');
    await world.addMember(centerId, 'bruno', 'client');

    const response = await getSubscription(ownerUserId);

    expect(response.statusCode).toBe(200);
    expect(response.json<SubscriptionBody>()).toMatchObject({
      status: 'trial',
      activeClientCount: 2,
    });
  });

  it('is only for owners and admins', async () => {
    const staff = await world.addMember(centerId, 'staff', 'staff');
    const client = await world.addMember(centerId, 'client', 'client');

    expect((await getSubscription(staff.userId)).statusCode).toBe(403);
    expect((await getSubscription(client.userId)).statusCode).toBe(403);
  });
});
