import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { BookingWorld, type CreatedTestCenter } from '../support/booking-world';
import { resetTestDatabase } from '../support/test-database';
import { createTestApplication } from './create-test-application';

interface ConsentSummaryBody {
  clientCount: number;
  privacy: number;
  health: number;
  marketing: number;
  image: number;
  parental: number;
}

describe('privacy and legal: consents given by the clients of the center', () => {
  let application: NestFastifyApplication;
  let world: BookingWorld;
  let owner: string;
  let center: CreatedTestCenter;

  const summaryUrl = (): string => `/v1/centers/${center.centerId}/privacy/consents`;
  const getSummary = (userId: string) =>
    world.call('GET', summaryUrl(), userId, { centerId: center.centerId });
  const setConsent = (userId: string, kind: string, isGranted: boolean) =>
    world.call('PUT', '/v1/me/consents', userId, { body: { kind, isGranted } });

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

  it('counts the latest answer of each client, so a withdrawn consent is not counted', async () => {
    const ana = await world.addMember(center.centerId, 'ana', 'client');
    const ben = await world.addMember(center.centerId, 'ben', 'client');
    await setConsent(ana.userId, 'marketing', true);
    await setConsent(ben.userId, 'marketing', true);
    await setConsent(ben.userId, 'marketing', false);
    await setConsent(ana.userId, 'image', true);

    const response = await getSummary(owner);

    expect(response.statusCode).toBe(200);
    expect(response.json<ConsentSummaryBody>()).toMatchObject({
      clientCount: 2,
      marketing: 1,
      image: 1,
      health: 0,
    });
  });

  it('never counts the consents of people who are not clients of this center', async () => {
    const otherOwner = await world.fixtures.createUser('otherowner');
    await world.createCenter(otherOwner, 'Otro Dojo');
    await setConsent(otherOwner, 'marketing', true);

    const response = await getSummary(owner);

    expect(response.json<ConsentSummaryBody>()).toMatchObject({ clientCount: 0, marketing: 0 });
  });

  it('is only for administration', async () => {
    const staff = await world.addMember(center.centerId, 'staff', 'staff');
    const client = await world.addMember(center.centerId, 'ana', 'client');

    const asStaff = await getSummary(staff.userId);
    const asClient = await getSummary(client.userId);

    expect(asStaff.statusCode).toBe(403);
    expect(asClient.statusCode).toBe(403);
  });
});
