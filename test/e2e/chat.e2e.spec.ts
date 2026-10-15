import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { v7 as generateUuidV7 } from 'uuid';
import { PrismaService } from '../../src/shared/database/prisma.service';
import { BookingWorld, type CreatedTestCenter } from '../support/booking-world';
import { resetTestDatabase } from '../support/test-database';
import { createTestApplication } from './create-test-application';

const MINOR_BIRTH_YEAR = new Date().getUTCFullYear() - 12;
const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');
const PNG_PADDING_BYTES = 64;

interface Person {
  userId: string;
  membershipId: string;
}

interface ConversationItem {
  id: string;
  counterpart: { kind: string; fullName?: string };
  unreadCount: number;
  lastMessage: { body: string | null; attachment: { kind: string } | null } | null;
}

interface ConversationListBody {
  unreadTotal: number;
  conversations: ConversationItem[];
}

describe('chat', () => {
  let application: NestFastifyApplication;
  let world: BookingWorld;
  let ownerUserId: string;
  let center: CreatedTestCenter;
  let centerId: string;
  let teacher: Person;
  let ana: Person;
  let luis: Person;
  let child: Person;

  const url = (path: string): string => `/v1/centers/${centerId}${path}`;

  async function openWith(person: Person, withMembershipId: string | null) {
    return world.call('POST', url('/conversations'), person.userId, {
      centerId,
      body: withMembershipId === null ? {} : { withMembershipId },
    });
  }

  const send = async (person: Person, conversationId: string, body: string) =>
    world.call('POST', url(`/conversations/${conversationId}/messages`), person.userId, {
      centerId,
      body: { body },
    });

  const listOf = async (userId: string): Promise<ConversationListBody> =>
    (await world.call('GET', url('/conversations'), userId, { centerId })).json();

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
    ana = await world.addMember(centerId, 'ana', 'client');
    luis = await world.addMember(centerId, 'luis', 'client');
    child = await world.addMember(centerId, 'child', 'client');
    await application.get(PrismaService).user.update({
      where: { id: child.userId },
      data: { birthDate: new Date(Date.UTC(MINOR_BIRTH_YEAR, 0, 1)) },
    });
  });

  afterAll(async () => {
    await application.close();
  });

  describe('between a client and a teacher', () => {
    it('lets them talk, and nobody else (not even the owner) reads it', async () => {
      const opened = await openWith(ana, teacher.membershipId);
      expect(opened.statusCode).toBe(201);
      const { conversationId } = opened.json<{ conversationId: string }>();
      expect((await send(ana, conversationId, 'Hola profe')).statusCode).toBe(201);

      const teacherList = await listOf(teacher.userId);
      expect(teacherList.unreadTotal).toBe(1);
      expect(teacherList.conversations[0]?.counterpart.fullName).toBeDefined();
      expect((await send(teacher, conversationId, 'Hola Ana')).statusCode).toBe(201);

      expect((await listOf(ownerUserId)).conversations).toEqual([]);
      const ownerRead = await world.call(
        'GET',
        url(`/conversations/${conversationId}/messages`),
        ownerUserId,
        { centerId },
      );
      expect(ownerRead.statusCode).toBe(404);
      const strangerRead = await world.call(
        'GET',
        url(`/conversations/${conversationId}/messages`),
        luis.userId,
        { centerId },
      );
      expect(strangerRead.statusCode).toBe(404);
    });

    it('reuses the same conversation and counts unread until it is read', async () => {
      const first = (await openWith(ana, teacher.membershipId)).json<{ conversationId: string }>();
      const again = (await openWith(teacher, ana.membershipId)).json<{ conversationId: string }>();
      expect(again.conversationId).toBe(first.conversationId);

      await send(ana, first.conversationId, 'Una');
      await send(ana, first.conversationId, 'Dos');
      expect((await listOf(teacher.userId)).unreadTotal).toBe(2);

      await world.call('POST', url(`/conversations/${first.conversationId}/read`), teacher.userId, {
        centerId,
      });
      expect((await listOf(teacher.userId)).unreadTotal).toBe(0);
    });

    it('lets a client write to any teacher of the center, even without a shared class', async () => {
      const opened = await openWith(luis, teacher.membershipId);
      expect(opened.statusCode).toBe(201);
    });

    it('does not let two clients write to each other', async () => {
      const denied = await openWith(ana, luis.membershipId);
      expect(denied.statusCode).toBe(403);
      expect(denied.json<{ code: string }>().code).toBe('CHAT_NOT_ALLOWED');
    });

    it('offers every teacher of the center to a client, and the center itself', async () => {
      const contacts = await world.call('GET', url('/conversations/contacts'), luis.userId, {
        centerId,
      });
      const body = contacts.json<{
        canWriteToCenter: boolean;
        people: { membershipId: string }[];
      }>();
      expect(body.canWriteToCenter).toBe(true);
      expect(body.people.map(({ membershipId }) => membershipId)).toEqual([teacher.membershipId]);
    });
  });

  describe('with the center', () => {
    it('reaches the administration, which answers on behalf of the center', async () => {
      const opened = (await openWith(ana, null)).json<{ conversationId: string }>();
      await send(ana, opened.conversationId, '¿Hay clase en festivo?');

      const ownerList = await listOf(ownerUserId);
      expect(ownerList.conversations).toHaveLength(1);
      expect(ownerList.unreadTotal).toBe(1);
      const reply = await send(
        { userId: ownerUserId, membershipId: center.ownerMembershipId },
        opened.conversationId,
        'Sí, abrimos',
      );
      expect(reply.statusCode).toBe(201);

      const anaList = await listOf(ana.userId);
      expect(anaList.conversations[0]?.counterpart.kind).toBe('center');
      expect(anaList.unreadTotal).toBe(1);
    });

    it('lets the center start a conversation with a client', async () => {
      const opened = await openWith(
        { userId: ownerUserId, membershipId: center.ownerMembershipId },
        luis.membershipId,
      );
      expect(opened.statusCode).toBe(201);
      expect((await listOf(luis.userId)).conversations[0]?.counterpart.kind).toBe('center');
    });
  });

  describe('to a group', () => {
    const asOwner = () => ({ userId: ownerUserId, membershipId: center.ownerMembershipId });

    async function createGroupWith(members: Person[]): Promise<string> {
      const created = await world.call('POST', url('/groups'), ownerUserId, {
        centerId,
        body: { name: 'Grupo mañanas' },
      });
      const groupId = created.json<{ id: string }>().id;
      for (const member of members) {
        await world.call('PATCH', url(`/clients/${member.membershipId}`), ownerUserId, {
          centerId,
          body: { groupId },
        });
      }
      return groupId;
    }

    it('lets the center write to everyone in a group, each in their own conversation', async () => {
      const groupId = await createGroupWith([ana, luis, child]);

      const sent = await world.call('POST', url('/conversations/broadcast'), ownerUserId, {
        centerId,
        body: { groupId, body: 'Mañana no hay clase' },
      });

      expect(sent.statusCode).toBe(201);
      expect(sent.json()).toEqual({ sentCount: 2, skippedMinorCount: 1 });
      for (const person of [ana, luis]) {
        const list = await listOf(person.userId);
        expect(list.conversations[0]?.counterpart.kind).toBe('center');
        expect(list.conversations[0]?.lastMessage?.body).toBe('Mañana no hay clase');
        expect(list.unreadTotal).toBe(1);
      }
      expect((await listOf(child.userId)).conversations).toEqual([]);
      expect((await listOf(asOwner().userId)).conversations).toHaveLength(2);
    });

    it('is not for clients, and needs an existing group', async () => {
      const groupId = await createGroupWith([ana]);
      const byClient = await world.call('POST', url('/conversations/broadcast'), ana.userId, {
        centerId,
        body: { groupId, body: 'Hola' },
      });
      const unknown = await world.call('POST', url('/conversations/broadcast'), ownerUserId, {
        centerId,
        body: { groupId: generateUuidV7(), body: 'Hola' },
      });

      expect(byClient.statusCode).toBe(403);
      expect(unknown.statusCode).toBe(404);
    });
  });

  describe('from a teacher to their groups', () => {
    async function createGroup(name: string, instructorMembershipId?: string): Promise<string> {
      const created = await world.call('POST', url('/groups'), ownerUserId, {
        centerId,
        body: { name, ...(instructorMembershipId && { instructorMembershipId }) },
      });
      return created.json<{ id: string }>().id;
    }

    const assign = (person: Person, groupId: string) =>
      world.call('PATCH', url(`/clients/${person.membershipId}`), ownerUserId, {
        centerId,
        body: { groupId },
      });

    it('lets a teacher write to their own group, in person and out of the owner reach', async () => {
      const groupId = await createGroup('Mis alumnos', teacher.membershipId);
      await assign(ana, groupId);

      const sent = await world.call('POST', url('/conversations/broadcast'), teacher.userId, {
        centerId,
        body: { groupId, body: 'Traed el kimono' },
      });

      expect(sent.statusCode).toBe(201);
      expect(sent.json()).toEqual({ sentCount: 1, skippedMinorCount: 0 });
      const received = await listOf(ana.userId);
      expect(received.conversations[0]?.counterpart).toMatchObject({
        kind: 'person',
        role: 'staff',
      });
      expect((await listOf(ownerUserId)).conversations).toEqual([]);
    });

    it('does not let a teacher write to a group that is not theirs, and lists only theirs', async () => {
      const otherTeacher = await world.addMember(centerId, 'other', 'staff');
      const mine = await createGroup('Mis alumnos', teacher.membershipId);
      const theirs = await createGroup('De otro', otherTeacher.membershipId);
      await assign(ana, theirs);

      const refused = await world.call('POST', url('/conversations/broadcast'), teacher.userId, {
        centerId,
        body: { groupId: theirs, body: 'Hola' },
      });
      const targets = await world.call(
        'GET',
        url('/conversations/broadcast/targets'),
        teacher.userId,
        {
          centerId,
        },
      );
      const ownerTargets = await world.call(
        'GET',
        url('/conversations/broadcast/targets'),
        ownerUserId,
        { centerId },
      );

      expect(refused.statusCode).toBe(404);
      expect(targets.json<{ groups: { id: string }[] }>().groups.map(({ id }) => id)).toEqual([
        mine,
      ]);
      expect(ownerTargets.json<{ groups: unknown[] }>().groups).toHaveLength(2);
    });
  });

  describe('minors', () => {
    it('cannot be written to and cannot write: only their guardians can', async () => {
      const toCenter = await openWith(child, null);
      expect(toCenter.statusCode).toBe(403);
      expect(toCenter.json<{ code: string }>().code).toBe('CHAT_MINOR_REQUIRES_GUARDIAN');

      const fromCenter = await openWith(
        { userId: ownerUserId, membershipId: center.ownerMembershipId },
        child.membershipId,
      );
      expect(fromCenter.statusCode).toBe(403);

      const contacts = await world.call('GET', url('/conversations/contacts'), ownerUserId, {
        centerId,
      });
      const names = contacts
        .json<{ people: { membershipId: string }[] }>()
        .people.map(({ membershipId }) => membershipId);
      expect(names).not.toContain(child.membershipId);
    });
  });

  describe('attachments and notices', () => {
    it('sends an image, rejects other files, and keeps one notice per conversation', async () => {
      const { conversationId } = (await openWith(ana, teacher.membershipId)).json<{
        conversationId: string;
      }>();
      const png = Buffer.concat([PNG_SIGNATURE, Buffer.alloc(PNG_PADDING_BYTES)]);
      const sent = await world.call(
        'POST',
        url(`/conversations/${conversationId}/attachments?fileName=foto.png`),
        ana.userId,
        { centerId, headers: { 'content-type': 'image/png' }, rawBody: png },
      );
      expect(sent.statusCode).toBe(201);
      expect(sent.json<{ attachment: { kind: string; name: string } }>().attachment).toMatchObject({
        kind: 'image',
        name: 'foto.png',
      });

      const notText = await world.call(
        'POST',
        url(`/conversations/${conversationId}/attachments?fileName=virus.exe`),
        ana.userId,
        {
          centerId,
          headers: { 'content-type': 'image/png' },
          rawBody: Buffer.from('MZ not an image'),
        },
      );
      expect(notText.statusCode).toBe(400);

      await send(ana, conversationId, 'Mirad la foto');
      const notices = await world.call('GET', url('/notifications'), teacher.userId, { centerId });
      const kinds = notices
        .json<{ notifications: { kind: string }[] }>()
        .notifications.filter(({ kind }) => kind === 'message_received');
      expect(kinds).toHaveLength(1);
    });
  });
});
