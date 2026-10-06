import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { BookingWorld, type CreatedTestCenter } from '../support/booking-world';
import { resetTestDatabase } from '../support/test-database';
import { createTestApplication } from './create-test-application';

interface ActivityBody {
  entries: { id: string; kind: string; subject: string | null; actorName: string | null }[];
}

describe('activity log: who did what in the center', () => {
  let application: NestFastifyApplication;
  let world: BookingWorld;
  let owner: string;
  let center: CreatedTestCenter;

  const activityUrl = (): string => `/v1/centers/${center.centerId}/activity`;
  const listActivity = (userId: string, query = '') =>
    world.call('GET', `${activityUrl()}${query}`, userId, { centerId: center.centerId });

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

  it('notes what the team changes, newest first, with the name of who did it', async () => {
    const service = await world.createService(owner, center.centerId, {
      name: 'Clase particular',
      durationMinutes: 60,
    });
    await world.call('PATCH', `/v1/centers/${center.centerId}/services/${service.id}`, owner, {
      centerId: center.centerId,
      body: { priceCents: 4500 },
    });
    await world.call('POST', `/v1/centers/${center.centerId}/join-code/regenerate`, owner, {
      centerId: center.centerId,
    });

    const response = await listActivity(owner);

    expect(response.statusCode).toBe(200);
    const { entries } = response.json<ActivityBody>();
    expect(entries.map(({ kind }) => kind)).toEqual([
      'join_code_regenerated',
      'service_updated',
      'service_created',
    ]);
    expect(entries[1]).toMatchObject({ subject: 'Clase particular' });
    expect(entries[0]?.actorName).not.toBeNull();
  });

  it('respects the limit', async () => {
    await world.createService(owner, center.centerId, { name: 'Uno', durationMinutes: 60 });
    await world.createService(owner, center.centerId, { name: 'Dos', durationMinutes: 60 });

    const response = await listActivity(owner, '?limit=1');

    expect(response.json<ActivityBody>().entries).toHaveLength(1);
  });

  it('is only for administration and never shows another center', async () => {
    await world.createService(owner, center.centerId, { name: 'Uno', durationMinutes: 60 });
    const staff = await world.addMember(center.centerId, 'staff', 'staff');
    const otherOwner = await world.fixtures.createUser('otherowner');
    const otherCenter = await world.createCenter(otherOwner, 'Otro Dojo');

    const asStaff = await listActivity(staff.userId);
    const other = await world.call(
      'GET',
      `/v1/centers/${otherCenter.centerId}/activity`,
      otherOwner,
      {
        centerId: otherCenter.centerId,
      },
    );

    expect(asStaff.statusCode).toBe(403);
    expect(other.json<ActivityBody>().entries).toEqual([]);
  });
});
