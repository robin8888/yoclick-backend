import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { BookingWorld, type CreatedTestCenter } from '../support/booking-world';
import { resetTestDatabase } from '../support/test-database';
import { createTestApplication } from './create-test-application';

interface RoomBody {
  id: string;
  name: string;
  capacity: number;
}

interface ServiceWithRoomBody {
  id: string;
  room: { id: string; name: string } | null;
}

describe('rooms and resources', () => {
  let application: NestFastifyApplication;
  let world: BookingWorld;
  let owner: string;
  let center: CreatedTestCenter;
  let staff: { userId: string; membershipId: string };
  let client: { userId: string; membershipId: string };

  const roomsUrl = (path = ''): string => `/v1/centers/${center.centerId}/rooms${path}`;
  const servicesUrl = (path = ''): string => `/v1/centers/${center.centerId}/services${path}`;

  const addRoom = (name: string, capacity?: number) =>
    world.call('POST', roomsUrl(), owner, {
      centerId: center.centerId,
      body: capacity === undefined ? { name } : { name, capacity },
    });

  async function listRooms(userId = owner): Promise<RoomBody[]> {
    const response = await world.call('GET', roomsUrl(), userId, { centerId: center.centerId });
    return response.json<{ rooms: RoomBody[] }>().rooms;
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
    client = await world.addMember(center.centerId, 'client', 'client');
  });

  afterAll(async () => {
    await application.close();
  });

  it('adds rooms with their capacity and lists them in creation order', async () => {
    const created = await addRoom('Sala 1', 12);
    await addRoom('Tatami');

    expect(created.statusCode).toBe(201);
    expect(created.json<RoomBody>()).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/) as string,
      name: 'Sala 1',
      capacity: 12,
    });
    expect((await listRooms()).map(({ name, capacity }) => [name, capacity])).toEqual([
      ['Sala 1', 12],
      ['Tatami', 1],
    ]);
  });

  it('lets the team read the rooms but not the clients', async () => {
    await addRoom('Sala 1');

    expect((await listRooms(staff.userId)).map(({ name }) => name)).toEqual(['Sala 1']);
    const asClient = await world.call('GET', roomsUrl(), client.userId, {
      centerId: center.centerId,
    });
    expect(asClient.statusCode).toBe(403);
  });

  it('only administration adds or removes rooms, and it needs the second factor', async () => {
    const asStaff = await world.call('POST', roomsUrl(), staff.userId, {
      centerId: center.centerId,
      body: { name: 'Sala 9' },
    });
    const withoutSecondFactor = await world.call('POST', roomsUrl(), owner, {
      centerId: center.centerId,
      body: { name: 'Sala 9' },
      isMfaVerified: false,
    });

    expect(asStaff.statusCode).toBe(403);
    expect(withoutSecondFactor.statusCode).toBe(403);
    expect(withoutSecondFactor.json<{ code: string }>().code).toBe('MFA_REQUIRED');
  });

  it.each([
    ['an empty name', { name: '   ' }],
    ['a name over 80 characters', { name: 'a'.repeat(81) }],
    ['a zero capacity', { name: 'Sala', capacity: 0 }],
    ['a capacity over 500', { name: 'Sala', capacity: 501 }],
    ['an unknown field', { name: 'Sala', color: 'red' }],
  ])('rejects %s', async (_caseName, body) => {
    const response = await world.call('POST', roomsUrl(), owner, {
      centerId: center.centerId,
      body,
    });

    expect(response.statusCode).toBe(400);
  });

  it('refuses a second active room with the same name, ignoring case', async () => {
    await addRoom('Sala 1');

    const duplicate = await addRoom('sala 1');

    expect(duplicate.statusCode).toBe(409);
    expect(await listRooms()).toHaveLength(1);
  });

  it('removes a room, frees its name and takes it off the services that used it', async () => {
    const room = (await addRoom('Sala 1')).json<RoomBody>();
    const service = (
      await world.call('POST', servicesUrl(), owner, {
        centerId: center.centerId,
        body: { name: 'Yoga', durationMinutes: 60, roomId: room.id },
      })
    ).json<ServiceWithRoomBody>();
    expect(service.room).toEqual({ id: room.id, name: 'Sala 1' });

    const removed = await world.call('DELETE', roomsUrl(`/${room.id}`), owner, {
      centerId: center.centerId,
    });

    expect(removed.statusCode).toBe(204);
    expect(await listRooms()).toEqual([]);
    const services = (
      await world.call('GET', servicesUrl(), owner, { centerId: center.centerId })
    ).json<{ services: ServiceWithRoomBody[] }>().services;
    expect(services.find(({ id }) => id === service.id)?.room).toBeNull();
    expect((await addRoom('Sala 1')).statusCode).toBe(201);
  });

  it('answers 404 when removing a room that is not there or was already removed', async () => {
    const room = (await addRoom('Sala 1')).json<RoomBody>();
    await world.call('DELETE', roomsUrl(`/${room.id}`), owner, { centerId: center.centerId });

    const again = await world.call('DELETE', roomsUrl(`/${room.id}`), owner, {
      centerId: center.centerId,
    });

    expect(again.statusCode).toBe(404);
  });

  it('assigns a room to a service and clears it with null', async () => {
    const room = (await addRoom('Sala 2', 8)).json<RoomBody>();
    const service = (
      await world.call('POST', servicesUrl(), owner, {
        centerId: center.centerId,
        body: { name: 'Pilates', durationMinutes: 50 },
      })
    ).json<ServiceWithRoomBody>();

    const assigned = await world.call('PATCH', servicesUrl(`/${service.id}`), owner, {
      centerId: center.centerId,
      body: { roomId: room.id },
    });
    const cleared = await world.call('PATCH', servicesUrl(`/${service.id}`), owner, {
      centerId: center.centerId,
      body: { roomId: null },
    });

    expect(assigned.json<ServiceWithRoomBody>().room).toEqual({ id: room.id, name: 'Sala 2' });
    expect(cleared.json<ServiceWithRoomBody>().room).toBeNull();
  });

  it('rejects a service in a room that does not exist, is archived or belongs to another center', async () => {
    const otherOwner = await world.fixtures.createUser('otherowner');
    const otherCenter = await world.createCenter(otherOwner, 'Otro centro');
    const foreignRoom = (
      await world.call('POST', `/v1/centers/${otherCenter.centerId}/rooms`, otherOwner, {
        centerId: otherCenter.centerId,
        body: { name: 'Ajena' },
      })
    ).json<RoomBody>();
    const archivedRoom = (await addRoom('Vieja')).json<RoomBody>();
    await world.call('DELETE', roomsUrl(`/${archivedRoom.id}`), owner, {
      centerId: center.centerId,
    });

    for (const roomId of [
      foreignRoom.id,
      archivedRoom.id,
      '0191d6a0-0000-7000-8000-00000000dead',
    ]) {
      const response = await world.call('POST', servicesUrl(), owner, {
        centerId: center.centerId,
        body: { name: 'Servicio', durationMinutes: 60, roomId },
      });

      expect(response.statusCode).toBe(400);
    }
  });

  it('never shows or touches the rooms of another center', async () => {
    const room = (await addRoom('Sala 1')).json<RoomBody>();
    const otherOwner = await world.fixtures.createUser('otherowner');
    const otherCenter = await world.createCenter(otherOwner, 'Otro centro');

    const otherList = await world.call(
      'GET',
      `/v1/centers/${otherCenter.centerId}/rooms`,
      otherOwner,
      {
        centerId: otherCenter.centerId,
      },
    );
    const foreignDelete = await world.call(
      'DELETE',
      `/v1/centers/${otherCenter.centerId}/rooms/${room.id}`,
      otherOwner,
      { centerId: otherCenter.centerId },
    );

    expect(otherList.json<{ rooms: RoomBody[] }>().rooms).toEqual([]);
    expect(foreignDelete.statusCode).toBe(404);
    expect(await listRooms()).toHaveLength(1);
  });
});
