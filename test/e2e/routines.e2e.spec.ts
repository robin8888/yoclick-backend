import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { randomUUID } from 'node:crypto';
import { BookingWorld, type CreatedTestCenter } from '../support/booking-world';
import { resetTestDatabase } from '../support/test-database';
import { createTestApplication } from './create-test-application';

interface RoutineBody {
  id: string;
  name: string;
  note: string | null;
  items: { name: string; category: string | null; prescription: string | null }[];
  assignments: { id: string; kind: string; targetName: string }[];
}

interface MyRoutineBody {
  id: string;
  name: string;
  items: { name: string }[];
}

const ITEMS = [
  { name: 'Sentadilla goblet', category: 'Piernas', prescription: '4 × 10 · 16 kg' },
  { name: 'Plancha frontal', category: '', prescription: '' },
  { name: 'Puente de glúteo' },
];

describe('routines', () => {
  let application: NestFastifyApplication;
  let world: BookingWorld;
  let center: CreatedTestCenter;
  let owner: string;
  let staff: { userId: string; membershipId: string };
  let ana: { userId: string; membershipId: string };
  let bruno: { userId: string; membershipId: string };

  const url = (path: string): string => `/v1/centers/${center.centerId}${path}`;
  const call = (
    method: 'GET' | 'POST' | 'DELETE' | 'PATCH',
    path: string,
    userId: string,
    body?: object,
  ) => world.call(method, url(path), userId, { centerId: center.centerId, ...(body && { body }) });

  async function createRoutine(extra: object = {}, userId = owner): Promise<RoutineBody> {
    const response = await call('POST', '/routines', userId, {
      name: 'Fuerza base',
      note: 'Descansa 90 s entre series.',
      items: ITEMS,
      ...extra,
    });
    expect(response.statusCode).toBe(201);
    return response.json<RoutineBody>();
  }

  async function myRoutines(userId: string): Promise<MyRoutineBody[]> {
    const response = await call('GET', '/my-routines', userId);
    return response.json<{ routines: MyRoutineBody[] }>().routines;
  }

  async function createGroupWith(members: { membershipId: string }[]): Promise<string> {
    const response = await call('POST', '/groups', owner, { name: 'Fuerza 50+' });
    const { id } = response.json<{ id: string }>();
    for (const member of members) {
      await call('PATCH', `/clients/${member.membershipId}`, owner, { groupId: id });
    }
    return id;
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
  });

  afterAll(async () => {
    await application.close();
  });

  describe('library and creation', () => {
    it('offers the exercises of the sector of the center', async () => {
      const response = await call('GET', '/exercise-library', owner);

      expect(response.statusCode).toBe(200);
      const { exercises } = response.json<{ exercises: { name: string; category: string }[] }>();
      expect(exercises.length).toBeGreaterThan(0);
      expect(exercises.every(({ name, category }) => name !== '' && category !== '')).toBe(true);
    });

    it('creates a routine keeping the order of the exercises and dropping blank texts', async () => {
      const routine = await createRoutine();

      expect(routine.name).toBe('Fuerza base');
      expect(routine.items.map(({ name }) => name)).toEqual([
        'Sentadilla goblet',
        'Plancha frontal',
        'Puente de glúteo',
      ]);
      expect(routine.items[1]).toMatchObject({ category: null, prescription: null });
      expect(routine.items[0]).toMatchObject({ prescription: '4 × 10 · 16 kg' });
      expect(routine.assignments).toEqual([]);
    });

    it('lists the routines with how many exercises and assignments each has', async () => {
      const routine = await createRoutine({ assignTo: { clientMembershipId: ana.membershipId } });

      const response = await call('GET', '/routines', owner);

      expect(response.json<{ routines: object[] }>().routines).toMatchObject([
        { id: routine.id, itemCount: 3, assignmentCount: 1 },
      ]);
    });

    it('lets an instructor create routines too', async () => {
      const routine = await createRoutine({}, staff.userId);

      expect(routine.name).toBe('Fuerza base');
    });

    it.each([
      ['no exercises', { items: [] }],
      [
        'too many exercises',
        { items: Array.from({ length: 31 }, (_unused, index) => ({ name: `E${String(index)}` })) },
      ],
      ['a blank name', { name: '  ' }],
      [
        'a client and a group at once',
        { assignTo: { clientMembershipId: randomUUID(), groupId: randomUUID() } },
      ],
      ['an exercise without name', { items: [{ name: '' }] }],
    ])('rejects a routine with %s', async (_name, override) => {
      const response = await call('POST', '/routines', owner, {
        name: 'Fuerza base',
        items: ITEMS,
        ...override,
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('assigning', () => {
    it('shows the routine to the client it was assigned to, and to nobody else', async () => {
      await createRoutine({ assignTo: { clientMembershipId: ana.membershipId } });

      expect(await myRoutines(ana.userId)).toMatchObject([{ name: 'Fuerza base' }]);
      expect(await myRoutines(bruno.userId)).toEqual([]);
    });

    it('tells the client with a notice when a routine is assigned to them', async () => {
      await createRoutine({ assignTo: { clientMembershipId: ana.membershipId } });

      const notices = await call('GET', '/notifications', ana.userId);

      expect(notices.json<{ notifications: { kind: string }[] }>().notifications).toMatchObject([
        { kind: 'routine_assigned' },
      ]);
    });

    it('shows the routine to every member of a group', async () => {
      const groupId = await createGroupWith([ana]);
      await createRoutine({ assignTo: { groupId } });

      expect(await myRoutines(ana.userId)).toHaveLength(1);
      expect(await myRoutines(bruno.userId)).toEqual([]);
    });

    it('assigns an existing routine later and lists who has it', async () => {
      const routine = await createRoutine();

      const response = await call('POST', `/routines/${routine.id}/assignments`, staff.userId, {
        clientMembershipId: bruno.membershipId,
      });

      expect(response.statusCode).toBe(201);
      expect(response.json<RoutineBody>().assignments).toMatchObject([
        { kind: 'client', targetName: 'bruno' },
      ]);
      expect(await myRoutines(bruno.userId)).toHaveLength(1);
    });

    it('does not assign the same routine twice to the same person', async () => {
      const routine = await createRoutine({ assignTo: { clientMembershipId: ana.membershipId } });

      const again = await call('POST', `/routines/${routine.id}/assignments`, owner, {
        clientMembershipId: ana.membershipId,
      });

      expect(again.statusCode).toBe(409);
    });

    it('does not show a routine twice to somebody who has it directly and through the group', async () => {
      const groupId = await createGroupWith([ana]);
      const routine = await createRoutine({ assignTo: { groupId } });
      await call('POST', `/routines/${routine.id}/assignments`, owner, {
        clientMembershipId: ana.membershipId,
      });

      expect(await myRoutines(ana.userId)).toHaveLength(1);
    });

    it.each([
      ['a person who is not a client of the center', () => ({ clientMembershipId: randomUUID() })],
      ['a group that does not exist', () => ({ groupId: randomUUID() })],
    ])('answers 404 for %s', async (_name, buildTarget) => {
      const response = await call('POST', '/routines', owner, {
        name: 'Fuerza base',
        items: ITEMS,
        assignTo: buildTarget(),
      });

      expect(response.statusCode).toBe(404);
    });

    it('stops showing the routine once the assignment is removed', async () => {
      const routine = await createRoutine({ assignTo: { clientMembershipId: ana.membershipId } });
      const [assignment] = routine.assignments;

      const removal = await call(
        'DELETE',
        `/routines/${routine.id}/assignments/${assignment?.id ?? ''}`,
        owner,
      );

      expect(removal.statusCode).toBe(204);
      expect(await myRoutines(ana.userId)).toEqual([]);
    });
  });

  describe('archiving and access', () => {
    it('hides an archived routine from the list and from whoever had it', async () => {
      const routine = await createRoutine({ assignTo: { clientMembershipId: ana.membershipId } });

      const archived = await call('DELETE', `/routines/${routine.id}`, owner);

      expect(archived.statusCode).toBe(204);
      expect(
        (await call('GET', '/routines', owner)).json<{ routines: object[] }>().routines,
      ).toEqual([]);
      expect(await myRoutines(ana.userId)).toEqual([]);
      expect((await call('GET', `/routines/${routine.id}`, owner)).statusCode).toBe(404);
    });

    it('keeps clients out of the routines of the team', async () => {
      const routine = await createRoutine();

      expect((await call('GET', '/routines', ana.userId)).statusCode).toBe(403);
      expect((await call('GET', `/routines/${routine.id}`, ana.userId)).statusCode).toBe(403);
      expect(
        (await call('POST', '/routines', ana.userId, { name: 'x', items: ITEMS })).statusCode,
      ).toBe(403);
    });

    it('keeps the team out of the client view', async () => {
      expect((await call('GET', '/my-routines', owner)).statusCode).toBe(403);
    });

    it('does not show the routines of another center', async () => {
      const routine = await createRoutine();
      const otherOwner = await world.fixtures.createUser('other-owner');
      const otherCenter = await world.createCenter(otherOwner, 'Otro centro');

      const response = await world.call(
        'GET',
        `/v1/centers/${otherCenter.centerId}/routines/${routine.id}`,
        otherOwner,
        {
          centerId: otherCenter.centerId,
        },
      );

      expect(response.statusCode).toBe(404);
    });
  });
});
