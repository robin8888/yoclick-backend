import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AccessTokenService } from '../../src/shared/auth/access-token.service';
import { PrismaService } from '../../src/shared/database/prisma.service';
import { TenantPrismaService } from '../../src/shared/database/tenant-prisma.service';
import { EMAIL_SENDER } from '../../src/shared/email/email-sender';
import { MILLISECONDS_PER_DAY } from '../../src/shared/time/time-units';
import { RecordingEmailSender } from '../support/auth-fakes';
import { DatabaseFixtures } from '../support/database-fixtures';
import { resetTestDatabase, runStatementAsOwnerForUser } from '../support/test-database';
import { createTestApplication } from './create-test-application';

const INVITATION_CODE_PATTERN = /\b([A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4})\b/;
const SIMULTANEOUS_ACCEPTANCES = 5;
const CLIENT_LIMIT = 2;

describe('team and invitations', () => {
  let application: NestFastifyApplication;
  let accessTokenService: AccessTokenService;
  let tenantPrismaService: TenantPrismaService;
  let fixtures: DatabaseFixtures;
  const emails = new RecordingEmailSender();
  let centerId: string;
  let owner: string;
  let admin: string;
  let otherAdmin: string;
  let staff: string;
  let client: string;
  let staffMembershipId: string;
  let adminMembershipId: string;
  let ownerMembershipId: string;
  let clientMembershipId: string;

  async function call(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    userId: string | undefined,
    body?: object,
    mfaVerified = true,
  ) {
    const headers: Record<string, string> = { 'x-center-id': centerId };
    if (userId) {
      const { token } = await accessTokenService.issue(userId, { isMfaVerified: mfaVerified });
      headers['authorization'] = `Bearer ${token}`;
    }
    return application.inject({ method, url, headers, ...(body && { payload: body }) });
  }

  const team = (path = '') => `/v1/centers/${centerId}/team${path}`;
  const invitations = (path = '') => `/v1/centers/${centerId}/invitations${path}`;

  async function invite(inviter: string, email: string, role: string) {
    return call('POST', invitations(), inviter, { email, role });
  }

  function lastInvitationCodeSentTo(email: string): string {
    const message = emails.messagesTo(email).at(-1);
    const code = INVITATION_CODE_PATTERN.exec(message?.textBody ?? '')?.[1];
    if (!code) throw new Error(`No invitation code was sent to ${email}`);
    return code;
  }

  async function createInvitee(prefix: string): Promise<{ userId: string; email: string }> {
    return { userId: await fixtures.createUser(prefix), email: `${prefix}@example.test` };
  }

  async function membershipOf(userId: string) {
    return tenantPrismaService.runInUserContext(userId, (prisma) =>
      prisma.membership.findFirst({ where: { userId, centerId } }),
    );
  }

  beforeAll(async () => {
    application = await createTestApplication({
      overrides: [{ token: EMAIL_SENDER, value: emails }],
    });
    accessTokenService = application.get(AccessTokenService);
    tenantPrismaService = application.get(TenantPrismaService);
    fixtures = new DatabaseFixtures(application.get(PrismaService), tenantPrismaService);
  });

  beforeEach(async () => {
    await resetTestDatabase();
    emails.sent.length = 0;
    centerId = await fixtures.createCenter('studio-norte', 'NORTE7');
    [owner, admin, otherAdmin, staff, client] = (await Promise.all(
      ['owner', 'admin', 'other-admin', 'staff', 'client'].map((name) => fixtures.createUser(name)),
    )) as [string, string, string, string, string];
    ownerMembershipId = await fixtures.createMembership({ centerId, userId: owner, role: 'owner' });
    adminMembershipId = await fixtures.createMembership({ centerId, userId: admin, role: 'admin' });
    await fixtures.createMembership({ centerId, userId: otherAdmin, role: 'admin' });
    staffMembershipId = await fixtures.createMembership({ centerId, userId: staff, role: 'staff' });
    clientMembershipId = await fixtures.createMembership({
      centerId,
      userId: client,
      role: 'client',
    });
  });

  afterAll(async () => {
    await application.close();
  });

  describe('team', () => {
    it('lists the team without clients, for owners and admins only', async () => {
      const response = await call('GET', team(), admin);

      const { members } = response.json<{ members: { role: string }[] }>();
      expect(
        members.map(({ role }) => role).sort((first, second) => first.localeCompare(second)),
      ).toEqual(['admin', 'admin', 'owner', 'staff']);
      expect((await call('GET', team(), staff)).statusCode).toBe(403);
      expect((await call('GET', team(), client)).statusCode).toBe(403);
    });

    it('needs a second-factor session for administrative roles', async () => {
      const response = await call('GET', team(), owner, undefined, false);

      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ code: 'MFA_REQUIRED' });
    });

    it('lets the owner promote staff to admin, set permissions and a title', async () => {
      const response = await call('PATCH', team(`/${staffMembershipId}`), owner, {
        role: 'admin',
        permissions: ['health:read', 'reports:view'],
        staffTitle: 'Directora técnica',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        role: 'admin',
        permissions: ['health:read', 'reports:view'],
        staffTitle: 'Directora técnica',
      });
    });

    it('lets an admin manage staff but not name admins', async () => {
      const permissions = await call('PATCH', team(`/${staffMembershipId}`), admin, {
        permissions: ['agenda:manage'],
      });
      const promotion = await call('PATCH', team(`/${staffMembershipId}`), admin, {
        role: 'admin',
      });

      expect(permissions.statusCode).toBe(200);
      expect(promotion.statusCode).toBe(403);
      expect(promotion.json()).toMatchObject({ code: 'TEAM_CHANGE_NOT_ALLOWED' });
      expect((await membershipOf(staff))?.role).toBe('staff');
    });

    it('does not let an admin touch another admin or the owner', async () => {
      const otherAdminMembership = (await membershipOf(otherAdmin))?.id as string;

      const onAdmin = await call('PATCH', team(`/${otherAdminMembership}`), admin, {
        status: 'blocked',
      });
      const onOwner = await call('PATCH', team(`/${ownerMembershipId}`), admin, {
        status: 'blocked',
      });

      expect(onAdmin.statusCode).toBe(403);
      expect(onOwner.statusCode).toBe(403);
    });

    it('does not let anyone, owner included, demote or block themselves', async () => {
      const ownSelf = await call('PATCH', team(`/${ownerMembershipId}`), owner, { status: 'left' });
      const adminSelf = await call('PATCH', team(`/${adminMembershipId}`), admin, {
        role: 'staff',
      });

      expect(ownSelf.statusCode).toBe(403);
      expect(adminSelf.statusCode).toBe(403);
    });

    it('answers 404 for a plain client or an unknown membership', async () => {
      const onClient = await call('PATCH', team(`/${clientMembershipId}`), owner, {
        staffTitle: 'Jefa',
      });
      const unknown = await call('PATCH', team('/01930000-0000-7000-8000-000000000999'), owner, {
        staffTitle: 'X',
      });

      expect(onClient.statusCode).toBe(404);
      expect(unknown.statusCode).toBe(404);
    });

    it('can block staff, who then lose access to the center', async () => {
      await call('PATCH', team(`/${staffMembershipId}`), owner, { status: 'blocked' });

      const asStaff = await call('GET', `/v1/centers/${centerId}/invitations`, staff);

      expect(asStaff.statusCode).toBe(404);
    });

    it.each([
      ['an unknown permission', { permissions: ['root:everything'] }],
      ['a duplicated permission', { permissions: ['health:read', 'health:read'] }],
      ['an owner role', { role: 'owner' }],
      ['an empty body', {}],
      ['an unknown field', { userId: 'x' }],
    ])('rejects %s with 400', async (_description, body) => {
      const response = await call('PATCH', team(`/${staffMembershipId}`), owner, body);

      expect(response.statusCode).toBe(400);
    });
  });

  describe('inviting', () => {
    it('invites by email: stores only a hash and sends a code without links', async () => {
      const response = await invite(owner, 'Nueva@Example.test', 'staff');

      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({ email: 'nueva@example.test', role: 'staff' });
      const message = emails.messagesTo('nueva@example.test')[0];
      expect(message?.textBody).not.toMatch(/https?:\/\//);
      const code = lastInvitationCodeSentTo('nueva@example.test').replaceAll('-', '');
      const stored = await application.get(PrismaService).$queryRaw<
        { token_hash: string }[]
      >`select token_hash from invitations`;
      expect(stored.map((row) => row.token_hash).join()).not.toContain(code);
    });

    it('returns the code of an invitation so the app can share it', async () => {
      const response = await invite(owner, 'visible@example.test', 'client');

      const { code } = response.json<{ code: string }>();

      expect(code).toBe(lastInvitationCodeSentTo('visible@example.test'));
    });

    it('invites by phone: normalizes the number, returns the code and sends no email', async () => {
      const response = await call('POST', invitations(), owner, {
        phone: '600 111 222',
        role: 'client',
      });

      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({
        email: null,
        phone: '+34600111222',
        role: 'client',
        code: expect.stringMatching(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/) as string,
      });
      expect(emails.messagesTo('600111222@example.test')).toEqual([]);
    });

    it('replaces the pending invitation when the same phone is invited again', async () => {
      const body = { phone: '+34600111222', role: 'client' };
      const first = (await call('POST', invitations(), owner, body)).json<{ code: string }>();
      const second = (await call('POST', invitations(), owner, body)).json<{ code: string }>();

      const firstPreview = await application.inject({
        method: 'GET',
        url: `/v1/join/invitations/${first.code}`,
      });
      const secondPreview = await application.inject({
        method: 'GET',
        url: `/v1/join/invitations/${second.code}`,
      });

      expect(firstPreview.statusCode).toBe(404);
      expect(secondPreview.statusCode).toBe(200);
    });

    it('needs exactly one of email or phone, and a real phone number', async () => {
      const both = await call('POST', invitations(), owner, {
        email: 'a@example.test',
        phone: '600111222',
        role: 'client',
      });
      const neither = await call('POST', invitations(), owner, { role: 'client' });
      const badPhone = await call('POST', invitations(), owner, { phone: '12345', role: 'client' });

      expect(both.statusCode).toBe(400);
      expect(neither.statusCode).toBe(400);
      expect(badPhone.statusCode).toBe(400);
    });

    it('lists phone invitations among the pending ones', async () => {
      await call('POST', invitations(), owner, { phone: '600111222', role: 'staff' });

      const pending = await call('GET', invitations(), owner);

      expect(pending.json<{ invitations: object[] }>().invitations).toMatchObject([
        { email: null, phone: '+34600111222', role: 'staff' },
      ]);
    });

    it('lets staff invite clients only, never team or admins', async () => {
      expect((await invite(staff, 'c1@example.test', 'client')).statusCode).toBe(201);
      expect((await invite(staff, 'c2@example.test', 'staff')).statusCode).toBe(403);
      expect((await invite(staff, 'c3@example.test', 'admin')).statusCode).toBe(403);
    });

    it('lets an admin invite admins, and forbids clients from inviting anyone', async () => {
      expect((await invite(admin, 'a1@example.test', 'admin')).statusCode).toBe(201);
      expect((await invite(client, 'a2@example.test', 'client')).statusCode).toBe(403);
    });

    it('refuses to invite someone who already belongs to the center', async () => {
      const response = await invite(owner, 'staff@example.test', 'staff');

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ code: 'ALREADY_MEMBER' });
    });

    it('replaces the pending invitation when the same address is invited again', async () => {
      await invite(owner, 'again@example.test', 'client');
      const firstCode = lastInvitationCodeSentTo('again@example.test');
      await invite(owner, 'again@example.test', 'client');

      const pending = (await call('GET', invitations(), owner)).json<{ invitations: unknown[] }>();
      const oldCode = await application.inject({
        method: 'GET',
        url: `/v1/join/invitations/${firstCode}`,
      });

      expect(pending.invitations).toHaveLength(1);
      expect(oldCode.statusCode).toBe(404);
    });

    it('lists and revokes pending invitations', async () => {
      const created = (await invite(owner, 'rev@example.test', 'client')).json<{ id: string }>();
      const code = lastInvitationCodeSentTo('rev@example.test');

      const revoked = await call('DELETE', invitations(`/${created.id}`), owner);
      const preview = await application.inject({
        method: 'GET',
        url: `/v1/join/invitations/${code}`,
      });
      const again = await call('DELETE', invitations(`/${created.id}`), owner);

      expect(revoked.statusCode).toBe(204);
      expect(preview.statusCode).toBe(404);
      expect(again.statusCode).toBe(404);
    });

    it('rejects malformed requests', async () => {
      expect((await invite(owner, 'not-an-email', 'client')).statusCode).toBe(400);
      expect((await invite(owner, 'x@example.test', 'owner')).statusCode).toBe(400);
    });
  });

  describe('accepting', () => {
    async function inviteAndGetCode(email: string, role: string): Promise<string> {
      await invite(owner, email, role);
      return lastInvitationCodeSentTo(email);
    }

    it('previews the center and role without exposing the full email', async () => {
      const code = await inviteAndGetCode('invitee@example.test', 'staff');

      const response = await application.inject({
        method: 'GET',
        url: `/v1/join/invitations/${code.toLowerCase()}`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        role: 'staff',
        emailHint: 'i***@example.test',
        center: { id: centerId, name: 'studio-norte' },
      });
      expect(JSON.stringify(response.json())).not.toContain('invitee@');
    });

    it('creates the membership with the invited role, once, for the matching account', async () => {
      const { userId } = await createInvitee('invitee');
      const code = await inviteAndGetCode('invitee@example.test', 'staff');

      const accepted = await call('POST', `/v1/join/invitations/${code}/accept`, userId);
      const reused = await call('POST', `/v1/join/invitations/${code}/accept`, userId);

      expect(accepted.statusCode).toBe(200);
      expect(accepted.json()).toMatchObject({ centerId, role: 'staff', status: 'active' });
      // Repetirlo con la misma cuenta (dos toques, un reintento) devuelve lo mismo, no un error.
      expect(reused.statusCode).toBe(200);
      expect(reused.json()).toEqual(accepted.json());
      expect(await membershipOf(userId)).toMatchObject({ role: 'staff', status: 'active' });
    });

    it('answers the same to two simultaneous acceptances of the same account', async () => {
      const { userId } = await createInvitee('invitee');
      const code = await inviteAndGetCode('invitee@example.test', 'staff');

      const responses = await Promise.all([
        call('POST', `/v1/join/invitations/${code}/accept`, userId),
        call('POST', `/v1/join/invitations/${code}/accept`, userId),
      ]);

      expect(responses.map((response) => response.statusCode)).toEqual([200, 200]);
    });

    it('refuses a code that another account already used', async () => {
      const { userId: first } = await createInvitee('first');
      const { userId: second } = await createInvitee('second');
      const { code } = (
        await call('POST', invitations(), owner, { phone: '600111222', role: 'client' })
      ).json<{ code: string }>();
      await call('POST', `/v1/join/invitations/${code}/accept`, first);

      const response = await call('POST', `/v1/join/invitations/${code}/accept`, second);

      expect(response.statusCode).toBe(404);
      expect(await membershipOf(second)).toBeNull();
    });

    it('does not accept the code for a different account, and answers like an unknown code', async () => {
      const { userId: intruder } = await createInvitee('intruder');
      const code = await inviteAndGetCode('invitee@example.test', 'admin');

      const stolen = await call('POST', `/v1/join/invitations/${code}/accept`, intruder);
      const unknown = await call('POST', '/v1/join/invitations/AAAA-BBBB-CCCC/accept', intruder);

      expect(stolen.statusCode).toBe(404);
      expect(stolen.json()).toMatchObject({ code: 'INVITATION_INVALID' });
      expect(unknown.json()).toMatchObject({ code: 'INVITATION_INVALID' });
      expect(await membershipOf(intruder)).toBeNull();
    });

    it('previews a phone invitation without any email hint', async () => {
      const { code } = (
        await call('POST', invitations(), owner, { phone: '600111222', role: 'client' })
      ).json<{ code: string }>();

      const response = await application.inject({
        method: 'GET',
        url: `/v1/join/invitations/${code}`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        role: 'client',
        emailHint: null,
        center: { id: centerId },
      });
    });

    it('lets any account accept a phone invitation with the invited role, and repeating it is harmless', async () => {
      const { userId } = await createInvitee('whatever');
      const { code } = (
        await call('POST', invitations(), owner, { phone: '600111222', role: 'staff' })
      ).json<{ code: string }>();

      const accepted = await call('POST', `/v1/join/invitations/${code}/accept`, userId);
      const reused = await call('POST', `/v1/join/invitations/${code}/accept`, userId);

      expect(accepted.statusCode).toBe(200);
      expect(accepted.json()).toMatchObject({ centerId, role: 'staff', status: 'active' });
      expect(reused.statusCode).toBe(200);
      expect(await membershipOf(userId)).toMatchObject({ role: 'staff', status: 'active' });
    });

    async function memberJoinedNotices() {
      return tenantPrismaService.runInTenantContext(
        {
          userId: owner,
          centerId,
          membershipId: ownerMembershipId,
          role: 'owner',
          permissions: [],
        },
        (client) =>
          client.notification.findMany({
            where: { kind: 'member_joined' },
            select: { recipientMembershipId: true, data: true },
          }),
      );
    }

    it('tells the owner and the admin that somebody joined, but not the person who joined', async () => {
      const { userId } = await createInvitee('whatever');
      const { code } = (
        await call('POST', invitations(), owner, { phone: '600111222', role: 'staff' })
      ).json<{ code: string }>();

      await call('POST', `/v1/join/invitations/${code}/accept`, userId);

      const notices = await memberJoinedNotices();
      const recipients = notices.map((notice) => notice.recipientMembershipId);
      // Propiedad y las dos administraciones del centro de prueba; la persona que entra no.
      expect(recipients).toHaveLength(3);
      expect(recipients).toEqual(expect.arrayContaining([ownerMembershipId, adminMembershipId]));
      expect(notices[0]?.data).toEqual({ personName: 'whatever', role: 'staff' });
    });

    it('does not tell anybody again when somebody who is already inside accepts another code', async () => {
      const { userId } = await createInvitee('whatever');
      const first = (
        await call('POST', invitations(), owner, { phone: '600111222', role: 'staff' })
      ).json<{ code: string }>();
      await call('POST', `/v1/join/invitations/${first.code}/accept`, userId);
      const second = (
        await call('POST', invitations(), owner, { phone: '600333444', role: 'staff' })
      ).json<{ code: string }>();

      await call('POST', `/v1/join/invitations/${second.code}/accept`, userId);

      expect(await memberJoinedNotices()).toHaveLength(3);
    });

    it('rejects expired invitations', async () => {
      const { userId } = await createInvitee('invitee');
      const code = await inviteAndGetCode('invitee@example.test', 'client');
      const expiredAt = new Date(Date.now() - MILLISECONDS_PER_DAY).toISOString();
      await runStatementAsOwnerForUser(
        owner,
        `update invitations set expires_at = '${expiredAt}'`,
        centerId,
      );

      const preview = await application.inject({
        method: 'GET',
        url: `/v1/join/invitations/${code}`,
      });
      const accepted = await call('POST', `/v1/join/invitations/${code}/accept`, userId);

      expect(preview.statusCode).toBe(404);
      expect(accepted.statusCode).toBe(404);
    });

    it('brings a former staff member back with the invited role, not the old one', async () => {
      const { userId } = await createInvitee('returning');
      await fixtures.createMembership({ centerId, userId, role: 'staff', status: 'left' });
      const clientCode = await inviteAndGetCode('returning@example.test', 'client');

      await call('POST', `/v1/join/invitations/${clientCode}/accept`, userId);

      expect(await membershipOf(userId)).toMatchObject({ role: 'client', status: 'active' });
    });

    it('does not let a blocked person back in through an invitation', async () => {
      const { userId } = await createInvitee('banned');
      const code = await inviteAndGetCode('banned@example.test', 'client');
      await fixtures.createMembership({ centerId, userId, role: 'client', status: 'blocked' });

      const response = await call('POST', `/v1/join/invitations/${code}/accept`, userId);

      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ code: 'MEMBERSHIP_BLOCKED' });
    });

    it('respects the client limit even when invitations are accepted simultaneously', async () => {
      await runStatementAsOwnerForUser(
        owner,
        `update centers set max_clients = ${String(CLIENT_LIMIT + 1)}`,
        centerId,
      );
      const attempts = await Promise.all(
        Array.from({ length: SIMULTANEOUS_ACCEPTANCES }, async (_unused, index) => {
          const { userId, email } = await createInvitee(`racer${String(index)}`);
          return { userId, code: await inviteAndGetCode(email, 'client') };
        }),
      );

      const responses = await Promise.all(
        attempts.map(({ userId, code }) =>
          call('POST', `/v1/join/invitations/${code}/accept`, userId),
        ),
      );

      expect(responses.filter(({ statusCode }) => statusCode === 200)).toHaveLength(CLIENT_LIMIT);
      expect(responses.filter(({ statusCode }) => statusCode === 409)).toHaveLength(
        SIMULTANEOUS_ACCEPTANCES - CLIENT_LIMIT,
      );
    });

    it('needs a session to accept but not to preview', async () => {
      const code = await inviteAndGetCode('invitee@example.test', 'client');

      expect(
        (await call('POST', `/v1/join/invitations/${code}/accept`, undefined)).statusCode,
      ).toBe(401);
      expect(
        (await application.inject({ method: 'GET', url: `/v1/join/invitations/${code}` }))
          .statusCode,
      ).toBe(200);
    });
  });
});
