import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { v7 as generateUuidV7 } from 'uuid';
import { PrismaService } from '../../src/shared/database/prisma.service';
import { BookingWorld, type CreatedTestCenter } from '../support/booking-world';
import { resetTestDatabase } from '../support/test-database';
import { createTestApplication } from './create-test-application';

const MILLISECONDS_PER_MINUTE = 60_000;
const CLASS_DURATION_MINUTES = 60;
const BIRTH_YEAR_OF_A_CHILD = new Date().getUTCFullYear() - 10;

interface Person {
  userId: string;
  membershipId: string;
}

describe('guardians (tutores)', () => {
  let application: NestFastifyApplication;
  let world: BookingWorld;
  let ownerUserId: string;
  let center: CreatedTestCenter;
  let centerId: string;
  let teacher: Person;
  let mother: Person;
  let stranger: Person;
  let child: Person;

  const url = (path: string): string => `/v1/centers/${centerId}${path}`;
  const link = (guardian: Person, forChild: Person = child) =>
    world.call('POST', url(`/clients/${forChild.membershipId}/guardians`), ownerUserId, {
      centerId,
      body: { guardianMembershipId: guardian.membershipId },
    });
  const childrenOf = async (person: Person) =>
    (await world.call('GET', url('/guardians/me/children'), person.userId, { centerId })).json<{
      children: {
        membershipId: string;
        upcomingBookings: { serviceName: string }[];
        remainingSessions: number;
      }[];
    }>().children;

  async function bookClass(forPerson: Person): Promise<void> {
    const serviceId = (
      await world.createService(ownerUserId, centerId, { name: 'Karate', durationMinutes: 60 })
    ).id;
    const startsAt = new Date(Date.now() + 60 * MILLISECONDS_PER_MINUTE);
    const sessionId = generateUuidV7();
    await world.tenantPrismaService.runInTenantContext(
      {
        userId: ownerUserId,
        centerId,
        membershipId: center.ownerMembershipId,
        role: 'owner',
        permissions: [],
      },
      async (prisma) => {
        await prisma.classSession.create({
          data: {
            id: sessionId,
            centerId,
            serviceId,
            staffMembershipId: teacher.membershipId,
            startsAt,
            endsAt: new Date(startsAt.getTime() + CLASS_DURATION_MINUTES * MILLISECONDS_PER_MINUTE),
          },
        });
        await prisma.booking.create({
          data: {
            id: generateUuidV7(),
            centerId,
            classSessionId: sessionId,
            clientMembershipId: forPerson.membershipId,
            status: 'confirmed',
          },
        });
      },
    );
  }

  beforeAll(async () => {
    application = await createTestApplication();
    world = new BookingWorld(application);
  });

  beforeEach(async () => {
    await resetTestDatabase();
    ownerUserId = await world.fixtures.createUser('owner');
    center = await world.createCenter(ownerUserId);
    centerId = center.centerId;
    teacher = await world.addMember(centerId, 'teacher', 'staff');
    mother = await world.addMember(centerId, 'mother', 'client');
    stranger = await world.addMember(centerId, 'stranger', 'client');
    child = await world.addMember(centerId, 'child', 'client');
    await application.get(PrismaService).user.update({
      where: { id: child.userId },
      data: { birthDate: new Date(Date.UTC(BIRTH_YEAR_OF_A_CHILD, 0, 1)) },
    });
  });

  afterAll(async () => {
    await application.close();
  });

  it('lets the center link, list and unlink a guardian', async () => {
    expect((await link(mother)).statusCode).toBe(201);
    expect((await link(mother)).statusCode).toBe(409);

    const listed = await world.call(
      'GET',
      url(`/clients/${child.membershipId}/guardians`),
      ownerUserId,
      {
        centerId,
      },
    );
    expect(listed.json<{ guardians: { membershipId: string }[] }>().guardians).toEqual([
      expect.objectContaining({ membershipId: mother.membershipId }),
    ]);

    const removed = await world.call(
      'DELETE',
      url(`/clients/${child.membershipId}/guardians/${mother.membershipId}`),
      ownerUserId,
      { centerId },
    );
    expect(removed.statusCode).toBe(204);
    expect(await childrenOf(mother)).toEqual([]);
  });

  it('refuses a minor as guardian and a person as their own guardian', async () => {
    const otherChild = await world.addMember(centerId, 'other', 'client');
    await application.get(PrismaService).user.update({
      where: { id: otherChild.userId },
      data: { birthDate: new Date(Date.UTC(BIRTH_YEAR_OF_A_CHILD, 5, 1)) },
    });

    expect((await link(otherChild)).statusCode).toBe(409);
    expect((await link(child, child)).statusCode).toBe(409);
  });

  it('shows a guardian the bookings and passes of their children, and nobody else', async () => {
    await link(mother);
    await bookClass(child);

    const mine = await childrenOf(mother);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      membershipId: child.membershipId,
      upcomingBookings: [expect.objectContaining({ serviceName: 'Karate' })],
    });
    expect(await childrenOf(stranger)).toEqual([]);
  });

  it('is only for the administration to link, and for clients to see their children', async () => {
    const byClient = await world.call(
      'POST',
      url(`/clients/${child.membershipId}/guardians`),
      mother.userId,
      { centerId, body: { guardianMembershipId: mother.membershipId } },
    );
    const byTeacher = await world.call('GET', url('/guardians/me/children'), teacher.userId, {
      centerId,
    });

    expect(byClient.statusCode).toBe(403);
    expect(byTeacher.statusCode).toBe(403);
  });

  it('makes a group message for a minor reach their guardian, saying whose it is', async () => {
    await link(mother);
    const group = await world.call('POST', url('/groups'), ownerUserId, {
      centerId,
      body: { name: 'Infantil' },
    });
    const groupId = group.json<{ id: string }>().id;
    await world.call('PATCH', url(`/clients/${child.membershipId}`), ownerUserId, {
      centerId,
      body: { groupId },
    });

    const sent = await world.call('POST', url('/conversations/broadcast'), ownerUserId, {
      centerId,
      body: { groupId, body: 'Mañana no hay clase' },
    });

    expect(sent.json()).toEqual({ sentCount: 1, skippedMinorCount: 0 });
    const received = await world.call('GET', url('/conversations'), mother.userId, { centerId });
    expect(
      received.json<{ conversations: { lastMessage: { body: string } }[] }>().conversations[0]
        ?.lastMessage.body,
    ).toBe('Para child: Mañana no hay clase');
  });
});
