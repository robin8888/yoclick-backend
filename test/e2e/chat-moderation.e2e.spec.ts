import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { BookingWorld, type CreatedTestCenter } from '../support/booking-world';
import { resetTestDatabase } from '../support/test-database';
import { createTestApplication } from './create-test-application';

interface Person {
  userId: string;
  membershipId: string;
}

interface ReportBody {
  id: string;
  reason: string;
  details: string | null;
  status: string;
  reporterName: string;
  reportedSenderName: string;
  reportedBody: string | null;
  reviewedAt: string | null;
}

interface NotificationListBody {
  unreadCount: number;
  notifications: { kind: string; data: Record<string, string>; isRead: boolean }[];
}

interface ConversationListBody {
  unreadTotal: number;
  conversations: { id: string }[];
}

const OFFENSIVE_TEXT = 'Texto que Ana quiere que revise la administración';

describe('chat moderation (reports and blocks)', () => {
  let application: NestFastifyApplication;
  let world: BookingWorld;
  let ownerUserId: string;
  let center: CreatedTestCenter;
  let centerId: string;
  let teacher: Person;
  let ana: Person;
  let luis: Person;

  const url = (path: string): string => `/v1/centers/${centerId}${path}`;

  async function openConversation(person: Person, withMembershipId: string | null) {
    return world.call('POST', url('/conversations'), person.userId, {
      centerId,
      body: withMembershipId === null ? {} : { withMembershipId },
    });
  }

  async function conversationBetween(person: Person, other: Person): Promise<string> {
    const opened = await openConversation(person, other.membershipId);
    return opened.json<{ conversationId: string }>().conversationId;
  }

  const send = (person: Person, conversationId: string, body: string) =>
    world.call('POST', url(`/conversations/${conversationId}/messages`), person.userId, {
      centerId,
      body: { body },
    });

  async function sendAndGetId(
    person: Person,
    conversationId: string,
    body: string,
  ): Promise<string> {
    const sent = await send(person, conversationId, body);
    expect(sent.statusCode).toBe(201);
    return sent.json<{ id: string }>().id;
  }

  const report = (
    person: Person,
    ids: { conversationId: string; messageId: string },
    body: Record<string, unknown>,
  ) =>
    world.call(
      'POST',
      url(`/conversations/${ids.conversationId}/messages/${ids.messageId}/report`),
      person.userId,
      { centerId, body },
    );

  const listReports = (userId: string, query = '') =>
    world.call('GET', url(`/message-reports${query}`), userId, { centerId });

  const block = (person: Person, blockedMembershipId: string) =>
    world.call('POST', url('/chat-blocks'), person.userId, {
      centerId,
      body: { blockedMembershipId },
    });

  const unblock = (person: Person, blockedMembershipId: string) =>
    world.call('DELETE', url(`/chat-blocks/${blockedMembershipId}`), person.userId, { centerId });

  const conversationsOf = async (userId: string): Promise<ConversationListBody> =>
    (await world.call('GET', url('/conversations'), userId, { centerId })).json();

  const notificationsOf = async (userId: string): Promise<NotificationListBody> =>
    (await world.call('GET', url('/notifications'), userId, { centerId })).json();

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
  });

  afterAll(async () => {
    await application.close();
  });

  describe('reporting a message', () => {
    let conversationId: string;
    let messageId: string;

    beforeEach(async () => {
      conversationId = await conversationBetween(ana, teacher);
      messageId = await sendAndGetId(teacher, conversationId, OFFENSIVE_TEXT);
    });

    it('lets the other person report it, and the owner reads only that copy', async () => {
      const created = await report(
        ana,
        { conversationId, messageId },
        { reason: 'harassment', details: 'Me lo ha dicho varias veces' },
      );

      expect(created.statusCode).toBe(201);
      expect(created.json()).toMatchObject({ status: 'open' });

      // El dueño sigue sin poder leer la conversación privada...
      const ownerRead = await world.call(
        'GET',
        url(`/conversations/${conversationId}/messages`),
        ownerUserId,
        { centerId },
      );
      expect(ownerRead.statusCode).toBe(404);
      expect((await conversationsOf(ownerUserId)).conversations).toEqual([]);

      // ...y solo ve el mensaje que se ha denunciado, con quién lo denuncia y por qué.
      const listed = (await listReports(ownerUserId)).json<{ reports: ReportBody[] }>().reports;
      expect(listed).toHaveLength(1);
      expect(listed[0]).toMatchObject({
        reason: 'harassment',
        details: 'Me lo ha dicho varias veces',
        status: 'open',
        reportedBody: OFFENSIVE_TEXT,
        reviewedAt: null,
      });
      expect(listed[0]?.reporterName).toBeTruthy();
      expect(listed[0]?.reportedSenderName).toBeTruthy();
    });

    it('warns the owner with a generic notice that carries only the reason', async () => {
      await report(ana, { conversationId, messageId }, { reason: 'spam' });

      const notices = await notificationsOf(ownerUserId);
      const reported = notices.notifications.filter(({ kind }) => kind === 'message_reported');
      expect(reported).toHaveLength(1);
      expect(reported[0]?.data).toEqual({ reason: 'spam' });
      expect(JSON.stringify(notices)).not.toContain(OFFENSIVE_TEXT);
      // Quien denuncia no recibe un aviso de lo que ha hecho él mismo.
      const own = await notificationsOf(ana.userId);
      expect(own.notifications.some(({ kind }) => kind === 'message_reported')).toBe(false);
    });

    it('does not duplicate the report nor warn again when it is reported twice', async () => {
      const first = await report(ana, { conversationId, messageId }, { reason: 'spam' });
      const second = await report(ana, { conversationId, messageId }, { reason: 'harassment' });

      expect(second.statusCode).toBe(201);
      expect(second.json<{ reportId: string }>().reportId).toBe(
        first.json<{ reportId: string }>().reportId,
      );
      expect((await listReports(ownerUserId)).json<{ reports: unknown[] }>().reports).toHaveLength(
        1,
      );
      const reported = (await notificationsOf(ownerUserId)).notifications.filter(
        ({ kind }) => kind === 'message_reported',
      );
      expect(reported).toHaveLength(1);
    });

    it('does not let someone outside the conversation report it, as if it did not exist', async () => {
      const stranger = await report(luis, { conversationId, messageId }, { reason: 'spam' });
      const ownerAttempt = await world.call(
        'POST',
        url(`/conversations/${conversationId}/messages/${messageId}/report`),
        ownerUserId,
        { centerId, body: { reason: 'spam' } },
      );

      expect(stranger.statusCode).toBe(404);
      expect(ownerAttempt.statusCode).toBe(404);
      expect((await listReports(ownerUserId)).json<{ reports: unknown[] }>().reports).toEqual([]);
    });

    it('does not let the author report their own message', async () => {
      const own = await report(teacher, { conversationId, messageId }, { reason: 'spam' });

      expect(own.statusCode).toBe(403);
      expect(own.json<{ code: string }>().code).toBe('CHAT_CANNOT_REPORT_OWN_MESSAGE');
    });

    it('answers 404 for a message that is not in that conversation', async () => {
      const other = await conversationBetween(luis, teacher);

      const wrongPair = await report(ana, { conversationId: other, messageId }, { reason: 'spam' });

      expect(wrongPair.statusCode).toBe(404);
    });

    it.each([
      { name: 'an unknown reason', body: { reason: 'rude' } },
      { name: 'no reason', body: {} },
      {
        name: 'more than 500 characters of details',
        body: { reason: 'other', details: 'a'.repeat(501) },
      },
      { name: 'unknown fields', body: { reason: 'spam', extra: true } },
    ])('refuses $name', async ({ body }) => {
      const refused = await report(ana, { conversationId, messageId }, body);

      expect(refused.statusCode).toBe(400);
    });
  });

  describe('reviewing the reports', () => {
    let reportId: string;

    beforeEach(async () => {
      const conversationId = await conversationBetween(ana, teacher);
      const messageId = await sendAndGetId(teacher, conversationId, OFFENSIVE_TEXT);
      reportId = (
        await report(ana, { conversationId, messageId }, { reason: 'inappropriate' })
      ).json<{ reportId: string }>().reportId;
    });

    it('lets the owner mark it as reviewed, and filter by status', async () => {
      const reviewed = await world.call(
        'POST',
        url(`/message-reports/${reportId}/review`),
        ownerUserId,
        {
          centerId,
        },
      );

      expect(reviewed.statusCode).toBe(200);
      expect(reviewed.json<ReportBody>()).toMatchObject({ id: reportId, status: 'reviewed' });
      expect(reviewed.json<ReportBody>().reviewedAt).not.toBeNull();
      const open = (await listReports(ownerUserId, '?status=open')).json<{ reports: unknown[] }>();
      const done = (await listReports(ownerUserId, '?status=reviewed')).json<{
        reports: unknown[];
      }>();
      expect(open.reports).toEqual([]);
      expect(done.reports).toHaveLength(1);
    });

    it('leaves it as it was when it is reviewed again', async () => {
      const first = await world.call(
        'POST',
        url(`/message-reports/${reportId}/review`),
        ownerUserId,
        {
          centerId,
        },
      );
      const second = await world.call(
        'POST',
        url(`/message-reports/${reportId}/review`),
        ownerUserId,
        {
          centerId,
        },
      );

      expect(second.statusCode).toBe(200);
      expect(second.json<ReportBody>().reviewedAt).toBe(first.json<ReportBody>().reviewedAt);
    });

    it('answers 404 for a report that does not exist', async () => {
      const missing = await world.call(
        'POST',
        url('/message-reports/0198a8a0-0000-7000-8000-0000000000aa/review'),
        ownerUserId,
        { centerId },
      );

      expect(missing.statusCode).toBe(404);
    });

    it.each([
      { name: 'a client', person: () => ana },
      { name: 'a teacher', person: () => teacher },
    ])('does not let $name list or review reports', async ({ person }) => {
      const listed = await listReports(person().userId);
      const reviewed = await world.call(
        'POST',
        url(`/message-reports/${reportId}/review`),
        person().userId,
        { centerId },
      );

      expect(listed.statusCode).toBe(403);
      expect(reviewed.statusCode).toBe(403);
    });

    it('does not show the reports of one center to the owner of another', async () => {
      const otherOwner = await world.fixtures.createUser('other-owner');
      const otherCenter = await world.createCenter(otherOwner);

      const listed = await world.call(
        'GET',
        `/v1/centers/${otherCenter.centerId}/message-reports`,
        otherOwner,
        { centerId: otherCenter.centerId },
      );
      const reviewed = await world.call(
        'POST',
        `/v1/centers/${otherCenter.centerId}/message-reports/${reportId}/review`,
        otherOwner,
        { centerId: otherCenter.centerId },
      );

      expect(listed.json<{ reports: unknown[] }>().reports).toEqual([]);
      expect(reviewed.statusCode).toBe(404);
    });
  });

  describe('blocking a person', () => {
    it('lets a client block a teacher and lists who is blocked', async () => {
      const blocked = await block(ana, teacher.membershipId);

      expect(blocked.statusCode).toBe(201);
      expect(blocked.json()).toMatchObject({ membershipId: teacher.membershipId, role: 'staff' });
      const list = await world.call('GET', url('/chat-blocks'), ana.userId, { centerId });
      expect(list.json<{ blocks: { membershipId: string }[] }>().blocks).toEqual([
        expect.objectContaining({ membershipId: teacher.membershipId }),
      ]);
    });

    it('does not fail or duplicate when blocking the same person twice, nor when unblocking twice', async () => {
      await block(ana, teacher.membershipId);
      const again = await block(ana, teacher.membershipId);
      const list = await world.call('GET', url('/chat-blocks'), ana.userId, { centerId });

      expect(again.statusCode).toBe(201);
      expect(list.json<{ blocks: unknown[] }>().blocks).toHaveLength(1);
      expect((await unblock(ana, teacher.membershipId)).statusCode).toBe(204);
      expect((await unblock(ana, teacher.membershipId)).statusCode).toBe(204);
    });

    it('stops the blocked person from writing, with the usual error that does not reveal the block', async () => {
      const conversationId = await conversationBetween(ana, teacher);
      await sendAndGetId(ana, conversationId, 'Hola profe');
      await block(ana, teacher.membershipId);

      const refused = await send(teacher, conversationId, 'Respondo');
      const reopened = await openConversation(teacher, ana.membershipId);

      expect(refused.statusCode).toBe(403);
      expect(refused.json<{ code: string }>().code).toBe('CHAT_NOT_ALLOWED');
      expect(reopened.statusCode).toBe(403);
      expect(reopened.json<{ code: string }>().code).toBe('CHAT_NOT_ALLOWED');
    });

    it('also stops the blocker from writing until they unblock', async () => {
      const conversationId = await conversationBetween(ana, teacher);
      await block(ana, teacher.membershipId);

      const whileBlocked = await send(ana, conversationId, '¿Sigues ahí?');
      await unblock(ana, teacher.membershipId);
      const afterwards = await send(ana, conversationId, '¿Sigues ahí?');

      expect(whileBlocked.statusCode).toBe(403);
      expect(afterwards.statusCode).toBe(201);
    });

    it('hides the conversation and its unread messages from whoever blocked, but not from the blocked person', async () => {
      const conversationId = await conversationBetween(ana, teacher);
      await sendAndGetId(teacher, conversationId, 'Recuerda traer el material');
      expect((await conversationsOf(ana.userId)).unreadTotal).toBe(1);
      expect((await notificationsOf(ana.userId)).unreadCount).toBe(1);

      await block(ana, teacher.membershipId);

      const anaList = await conversationsOf(ana.userId);
      expect(anaList.conversations).toEqual([]);
      expect(anaList.unreadTotal).toBe(0);
      expect((await notificationsOf(ana.userId)).unreadCount).toBe(0);
      expect((await conversationsOf(teacher.userId)).conversations).toHaveLength(1);

      await unblock(ana, teacher.membershipId);
      expect((await conversationsOf(ana.userId)).conversations).toHaveLength(1);
    });

    it('stops offering each other as contacts, and offers them again after unblocking', async () => {
      const contactsOf = async (person: Person) =>
        (await world.call('GET', url('/conversations/contacts'), person.userId, { centerId }))
          .json<{ people: { membershipId: string }[] }>()
          .people.map(({ membershipId }) => membershipId);
      expect(await contactsOf(ana)).toContain(teacher.membershipId);

      await block(ana, teacher.membershipId);

      expect(await contactsOf(ana)).not.toContain(teacher.membershipId);
      expect(await contactsOf(teacher)).not.toContain(ana.membershipId);
      expect(await contactsOf(teacher)).toContain(luis.membershipId);
      await unblock(ana, teacher.membershipId);
      expect(await contactsOf(ana)).toContain(teacher.membershipId);
    });

    it('skips a person who blocked the teacher when the teacher writes to a whole group', async () => {
      const created = await world.call('POST', url('/groups'), ownerUserId, {
        centerId,
        body: { name: 'Mis alumnos', instructorMembershipId: teacher.membershipId },
      });
      const groupId = created.json<{ id: string }>().id;
      for (const person of [ana, luis]) {
        await world.call('PATCH', url(`/clients/${person.membershipId}`), ownerUserId, {
          centerId,
          body: { groupId },
        });
      }
      await block(ana, teacher.membershipId);

      const sent = await world.call('POST', url('/conversations/broadcast'), teacher.userId, {
        centerId,
        body: { groupId, body: 'Mañana no hay clase' },
      });

      expect(sent.json()).toEqual({ sentCount: 1, skippedMinorCount: 0 });
      expect((await conversationsOf(ana.userId)).conversations).toEqual([]);
      expect((await conversationsOf(luis.userId)).conversations).toHaveLength(1);
    });

    it('does not affect the conversation with the center: the administration is always reachable', async () => {
      await block(ana, teacher.membershipId);

      const opened = await openConversation(ana, null);
      const sent = await send(
        ana,
        opened.json<{ conversationId: string }>().conversationId,
        '¿Hay clase en festivo?',
      );

      expect(sent.statusCode).toBe(201);
      expect((await conversationsOf(ownerUserId)).conversations).toHaveLength(1);
    });

    it.each([
      { name: 'themselves', blocker: () => ana, target: () => ana.membershipId },
      { name: 'another client', blocker: () => ana, target: () => luis.membershipId },
      { name: 'the owner', blocker: () => ana, target: () => center.ownerMembershipId },
      {
        name: 'the owner, as a teacher',
        blocker: () => teacher,
        target: () => center.ownerMembershipId,
      },
    ])('does not let a person block $name', async ({ blocker, target }) => {
      const refused = await block(blocker(), target());

      expect(refused.statusCode).toBe(403);
      expect(refused.json<{ code: string }>().code).toBe('CHAT_BLOCK_NOT_ALLOWED');
    });

    it('does not let the administration use the blocks: it speaks on behalf of the center', async () => {
      const refused = await world.call('POST', url('/chat-blocks'), ownerUserId, {
        centerId,
        body: { blockedMembershipId: ana.membershipId },
      });

      expect(refused.statusCode).toBe(403);
    });

    it('answers 404 for someone who does not exist or belongs to another center', async () => {
      const otherOwner = await world.fixtures.createUser('other-owner');
      const otherCenter = await world.createCenter(otherOwner);
      const outsider = await world.addMember(otherCenter.centerId, 'outsider', 'staff');

      const unknown = await block(ana, '0198a8a0-0000-7000-8000-0000000000bb');
      const foreign = await block(ana, outsider.membershipId);

      expect(unknown.statusCode).toBe(404);
      expect(foreign.statusCode).toBe(404);
    });

    it('keeps each block private: others do not see it nor can they remove it', async () => {
      const conversationId = await conversationBetween(ana, teacher);
      await block(ana, teacher.membershipId);

      const luisList = await world.call('GET', url('/chat-blocks'), luis.userId, { centerId });
      const teacherList = await world.call('GET', url('/chat-blocks'), teacher.userId, {
        centerId,
      });
      const luisUnblock = await unblock(luis, teacher.membershipId);
      const teacherUnblock = await unblock(teacher, ana.membershipId);

      expect(luisList.json<{ blocks: unknown[] }>().blocks).toEqual([]);
      expect(teacherList.json<{ blocks: unknown[] }>().blocks).toEqual([]);
      expect(luisUnblock.statusCode).toBe(204);
      expect(teacherUnblock.statusCode).toBe(204);
      // Ana sigue teniendo bloqueado al profesor: nadie ha podido quitárselo.
      expect((await send(teacher, conversationId, 'Hola')).statusCode).toBe(403);
    });
  });
});
