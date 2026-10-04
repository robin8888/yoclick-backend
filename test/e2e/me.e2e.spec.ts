import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { BREACHED_PASSWORD_CHECKER } from '../../src/modules/auth/application/ports/breached-password.checker';
import { PrismaService } from '../../src/shared/database/prisma.service';
import { TenantPrismaService } from '../../src/shared/database/tenant-prisma.service';
import { EMAIL_SENDER } from '../../src/shared/email/email-sender';
import { FakeBreachedPasswordChecker, RecordingEmailSender } from '../support/auth-fakes';
import { DatabaseFixtures } from '../support/database-fixtures';
import { resetTestDatabase } from '../support/test-database';
import { createTestApplication } from './create-test-application';

const EMAIL = 'robin@yopmail.com';
const OTHER_EMAIL = 'otra@yopmail.com';
const PASSWORD = 'Nosnibor88';
const NEW_PASSWORD = 'a brand new passphrase 2026';

interface SessionBody {
  accessToken: string;
  refreshToken: string;
  user: { id: string };
}

describe('the person own account (/v1/me)', () => {
  let application: NestFastifyApplication;
  let prismaService: PrismaService;
  let tenantPrismaService: TenantPrismaService;
  let fixtures: DatabaseFixtures;
  const emails = new RecordingEmailSender();

  async function send(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    url: string,
    accessToken: string | undefined,
    payload?: unknown,
  ) {
    return application.inject({
      method,
      url,
      ...(payload !== undefined && { payload: payload as object }),
      headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {},
    });
  }

  async function createVerifiedAccount(email: string): Promise<void> {
    await application.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: {
        email,
        password: PASSWORD,
        fullName: 'Robin Rodríguez',
        consents: { privacy: true, terms: true, marketing: false },
      },
    });
    await application.inject({
      method: 'POST',
      url: '/v1/auth/email/verify',
      payload: { email, code: emails.lastCodeSentTo(email) },
    });
  }

  async function login(email = EMAIL, password = PASSWORD) {
    return application.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email, password },
    });
  }

  async function signIn(email = EMAIL): Promise<SessionBody> {
    return (await login(email)).json<SessionBody>();
  }

  beforeAll(async () => {
    application = await createTestApplication({
      overrides: [
        { token: EMAIL_SENDER, value: emails },
        { token: BREACHED_PASSWORD_CHECKER, value: new FakeBreachedPasswordChecker() },
      ],
    });
    prismaService = application.get(PrismaService);
    tenantPrismaService = application.get(TenantPrismaService);
    fixtures = new DatabaseFixtures(prismaService, tenantPrismaService);
  });

  beforeEach(async () => {
    await resetTestDatabase();
    emails.sent.length = 0;
    await createVerifiedAccount(EMAIL);
  });

  afterAll(async () => {
    await application.close();
  });

  describe('profile', () => {
    it('requires being signed in', async () => {
      expect((await send('GET', '/v1/me', undefined)).statusCode).toBe(401);
    });

    it('returns my profile, never the password hash', async () => {
      const session = await signIn();

      const response = await send('GET', '/v1/me', session.accessToken);

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        id: session.user.id,
        email: EMAIL,
        fullName: 'Robin Rodríguez',
        phone: null,
        birthDate: null,
        locale: 'es-ES',
        isEmailVerified: true,
      });
      expect(response.body).not.toContain('argon2');
      expect(response.body).not.toContain('passwordHash');
    });

    it('updates the editable fields', async () => {
      const session = await signIn();

      const response = await send('PATCH', '/v1/me', session.accessToken, {
        fullName: 'Robin R. Correa',
        phone: '+34 600 123 456',
        birthDate: '1990-05-17',
        locale: 'en',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        fullName: 'Robin R. Correa',
        phone: '+34 600 123 456',
        birthDate: '1990-05-17',
        locale: 'en',
      });
    });

    it('changes only the fields sent and clears one with null', async () => {
      const session = await signIn();
      await send('PATCH', '/v1/me', session.accessToken, { phone: '+34 600 123 456' });

      const response = await send('PATCH', '/v1/me', session.accessToken, { phone: null });

      expect(response.json()).toMatchObject({ phone: null, fullName: 'Robin Rodríguez' });
    });

    it.each([
      ['an empty body', {}],
      ['the email, which has its own flow', { email: 'new@yopmail.com' }],
      ['an id', { id: '01a10685-b683-70b8-bc14-b2fed580d44c' }],
      ['a forged verification flag', { isEmailVerified: false }],
      ['a future birth date', { birthDate: '2999-01-01' }],
      ['an absurd birth date', { birthDate: '1200-01-01' }],
      ['an invalid phone', { phone: 'call me maybe' }],
      ['an unsupported language', { locale: 'klingon' }],
    ])('rejects %s with 400', async (_description, body) => {
      const session = await signIn();

      const response = await send('PATCH', '/v1/me', session.accessToken, body);

      expect(response.statusCode).toBe(400);
    });

    it('never touches another person: the id always comes from the token', async () => {
      await createVerifiedAccount(OTHER_EMAIL);
      const session = await signIn();

      await send('PATCH', '/v1/me', session.accessToken, { fullName: 'Changed Name' });

      const other = await prismaService.user.findUniqueOrThrow({ where: { email: OTHER_EMAIL } });
      expect(other.fullName).toBe('Robin Rodríguez');
    });
  });

  describe('my centers', () => {
    it('lists the centers I belong to with their brand, and only mine', async () => {
      await createVerifiedAccount(OTHER_EMAIL);
      const session = await signIn();
      const norte = await fixtures.createCenter('studio-norte', 'NORTE7');
      const forja = await fixtures.createCenter('forja', 'FORJA2');
      const kine = await fixtures.createCenter('kine-lab', 'KINE24');
      await fixtures.createMembership({ centerId: norte, userId: session.user.id, role: 'client' });
      await fixtures.createMembership({ centerId: forja, userId: session.user.id, role: 'staff' });
      const otherUser = await prismaService.user.findUniqueOrThrow({
        where: { email: OTHER_EMAIL },
      });
      await fixtures.createMembership({ centerId: kine, userId: otherUser.id, role: 'client' });

      const response = await send('GET', '/v1/me/memberships', session.accessToken);

      const { memberships } = response.json<{
        memberships: {
          centerId: string;
          role: string;
          center: { slug: string; brandColor: string };
        }[];
      }>();
      expect(
        memberships
          .map(({ center }) => center.slug)
          .sort((first, second) => first.localeCompare(second)),
      ).toEqual(['forja', 'studio-norte']);
      expect(memberships.find(({ centerId }) => centerId === forja)?.role).toBe('staff');
      expect(memberships[0]?.center.brandColor).toBe('#E4572E');
    });

    it('leaves out the centers I have left', async () => {
      const session = await signIn();
      const norte = await fixtures.createCenter('studio-norte', 'NORTE7');
      await fixtures.createMembership({
        centerId: norte,
        userId: session.user.id,
        role: 'client',
        status: 'left',
      });

      const response = await send('GET', '/v1/me/memberships', session.accessToken);

      expect(response.json<{ memberships: unknown[] }>().memberships).toEqual([]);
    });
  });

  describe('consents', () => {
    it('shows the current state of each consent given at registration', async () => {
      const session = await signIn();

      const response = await send('GET', '/v1/me/consents', session.accessToken);

      const { consents } = response.json<{ consents: { kind: string; isGranted: boolean }[] }>();
      const byKind = Object.fromEntries(consents.map(({ kind, isGranted }) => [kind, isGranted]));
      expect(byKind).toEqual({ privacy: true, terms: true, marketing: false });
    });

    it('grants and withdraws an optional consent, keeping every change as its own row', async () => {
      const session = await signIn();

      await send('PUT', '/v1/me/consents', session.accessToken, {
        kind: 'marketing',
        isGranted: true,
      });
      const withdrawn = await send('PUT', '/v1/me/consents', session.accessToken, {
        kind: 'marketing',
        isGranted: false,
      });

      const history = await tenantPrismaService.runInUserContext(session.user.id, (client) =>
        client.consent.findMany({ where: { kind: 'marketing' } }),
      );
      expect(history).toHaveLength(3);
      const marketing = withdrawn
        .json<{ consents: { kind: string; isGranted: boolean }[] }>()
        .consents.find(({ kind }) => kind === 'marketing');
      expect(marketing?.isGranted).toBe(false);
    });

    it('reports the latest change as current', async () => {
      const session = await signIn();

      const response = await send('PUT', '/v1/me/consents', session.accessToken, {
        kind: 'image',
        isGranted: true,
      });

      const { consents } = response.json<{ consents: { kind: string; isGranted: boolean }[] }>();
      expect(consents.find(({ kind }) => kind === 'image')?.isGranted).toBe(true);
    });

    it.each(['privacy', 'terms', 'health', 'parental', 'anything'])(
      'refuses to change the %s consent here',
      async (kind) => {
        const session = await signIn();

        const response = await send('PUT', '/v1/me/consents', session.accessToken, {
          kind,
          isGranted: false,
        });

        expect(response.statusCode).toBe(400);
      },
    );
  });

  describe('POST /v1/me/password', () => {
    it('changes the password and signs me out everywhere, this device included', async () => {
      const session = await signIn();

      const response = await send('POST', '/v1/me/password', session.accessToken, {
        currentPassword: PASSWORD,
        newPassword: NEW_PASSWORD,
      });
      const refresh = await application.inject({
        method: 'POST',
        url: '/v1/auth/refresh',
        payload: { refreshToken: session.refreshToken },
      });

      expect(response.statusCode).toBe(200);
      expect(refresh.statusCode).toBe(401);
      expect((await login(EMAIL, NEW_PASSWORD)).statusCode).toBe(200);
      expect((await login(EMAIL, PASSWORD)).statusCode).toBe(401);
    });

    it('asks for the current password: a stolen access token is not enough (SEC-12)', async () => {
      const session = await signIn();

      const response = await send('POST', '/v1/me/password', session.accessToken, {
        currentPassword: 'not my password',
        newPassword: NEW_PASSWORD,
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ code: 'REAUTHENTICATION_FAILED' });
      expect((await login(EMAIL, PASSWORD)).statusCode).toBe(200);
    });

    it('counts wrong current passwords towards the same lockout as login', async () => {
      const session = await signIn();
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await send('POST', '/v1/me/password', session.accessToken, {
          currentPassword: 'not my password',
          newPassword: NEW_PASSWORD,
        });
      }

      expect((await login(EMAIL, PASSWORD)).statusCode).toBe(401);
    });

    it('rejects a new password equal to the current one', async () => {
      const session = await signIn();

      const response = await send('POST', '/v1/me/password', session.accessToken, {
        currentPassword: PASSWORD,
        newPassword: PASSWORD,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json<{ errors: unknown[] }>().errors).toContainEqual({
        path: 'newPassword',
        code: 'same_as_current',
      });
    });

    it('rejects a weak new password naming newPassword', async () => {
      const session = await signIn();

      const response = await send('POST', '/v1/me/password', session.accessToken, {
        currentPassword: PASSWORD,
        newPassword: 'short',
      });

      expect(response.statusCode).toBe(400);
      expect(response.json<{ errors: unknown[] }>().errors).toContainEqual({
        path: 'newPassword',
        code: 'too_short',
      });
    });

    it('tells the owner by email that the password changed', async () => {
      const session = await signIn();
      emails.sent.length = 0;

      await send('POST', '/v1/me/password', session.accessToken, {
        currentPassword: PASSWORD,
        newPassword: NEW_PASSWORD,
      });

      expect(emails.messagesTo(EMAIL)[0]?.subject).toMatch(/contraseña se ha cambiado/i);
    });
  });

  describe('POST /v1/me/data-export', () => {
    it('exports my profile, centers and the full consent history, for the right password', async () => {
      const session = await signIn();
      const norte = await fixtures.createCenter('studio-norte', 'NORTE7');
      await fixtures.createMembership({ centerId: norte, userId: session.user.id, role: 'client' });
      await send('PUT', '/v1/me/consents', session.accessToken, {
        kind: 'marketing',
        isGranted: true,
      });

      const response = await send('POST', '/v1/me/data-export', session.accessToken, {
        password: PASSWORD,
      });

      expect(response.statusCode).toBe(200);
      const exported = response.json<{
        profile: { email: string };
        memberships: unknown[];
        consentHistory: unknown[];
      }>();
      expect(exported.profile.email).toBe(EMAIL);
      expect(exported.memberships).toHaveLength(1);
      expect(exported.consentHistory).toHaveLength(4);
    });

    it('never includes the password hash or any secret', async () => {
      const session = await signIn();

      const response = await send('POST', '/v1/me/data-export', session.accessToken, {
        password: PASSWORD,
      });

      expect(response.body).not.toContain('argon2');
      expect(response.body).not.toMatch(/passwordHash|tokenHash|codeHash|refreshToken/);
    });

    it('asks for the password again, and refuses a wrong one', async () => {
      const session = await signIn();

      const response = await send('POST', '/v1/me/data-export', session.accessToken, {
        password: 'not my password',
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ code: 'REAUTHENTICATION_FAILED' });
    });
  });

  describe('DELETE /v1/me', () => {
    async function deleteAccount(accessToken: string, body: unknown) {
      return send('DELETE', '/v1/me', accessToken, body);
    }

    it('deletes the account: 204, and nothing works for it afterwards', async () => {
      const session = await signIn();

      const response = await deleteAccount(session.accessToken, {
        password: PASSWORD,
        confirmation: 'ELIMINAR',
      });

      expect(response.statusCode).toBe(204);
      expect((await login()).statusCode).toBe(401);
      const refresh = await application.inject({
        method: 'POST',
        url: '/v1/auth/refresh',
        payload: { refreshToken: session.refreshToken },
      });
      expect(refresh.statusCode).toBe(401);
    });

    it('closes the door even to an access token that has not expired yet', async () => {
      const session = await signIn();
      await deleteAccount(session.accessToken, { password: PASSWORD, confirmation: 'ELIMINAR' });

      const response = await send('GET', '/v1/me', session.accessToken);

      expect(response.statusCode).toBe(401);
    });

    it('anonymizes everything personal and frees the email', async () => {
      const session = await signIn();
      await send('PATCH', '/v1/me', session.accessToken, {
        phone: '+34 600 123 456',
        birthDate: '1990-05-17',
      });

      await deleteAccount(session.accessToken, { password: PASSWORD, confirmation: 'ELIMINAR' });

      const erased = await prismaService.user.findUniqueOrThrow({ where: { id: session.user.id } });
      expect(erased).toMatchObject({
        email: `deleted-${session.user.id}@deleted.invalid`,
        fullName: 'Usuario eliminado',
        phone: null,
        birthDate: null,
        emailVerifiedAt: null,
      });
      expect(erased.deletedAt).toBeInstanceOf(Date);
      expect(erased.passwordHash).not.toMatch(/^\$argon2/);
    });

    it('lets the same email register again as a brand new account', async () => {
      const session = await signIn();
      await deleteAccount(session.accessToken, { password: PASSWORD, confirmation: 'ELIMINAR' });

      await createVerifiedAccount(EMAIL);

      const fresh = await signIn();
      expect(fresh.user.id).not.toBe(session.user.id);
    });

    it('removes sessions, codes and idempotency records, and leaves every center', async () => {
      const session = await signIn();
      const norte = await fixtures.createCenter('studio-norte', 'NORTE7');
      await fixtures.createMembership({ centerId: norte, userId: session.user.id, role: 'client' });
      await application.inject({
        method: 'POST',
        url: '/v1/auth/password/forgot',
        payload: { email: EMAIL },
      });

      await deleteAccount(session.accessToken, { password: PASSWORD, confirmation: 'ELIMINAR' });

      const refreshTokens = await tenantPrismaService.runInPublicContext((client) =>
        client.refreshToken.count({ where: { userId: session.user.id } }),
      );
      const codes = await tenantPrismaService.runInUserContext(session.user.id, (client) =>
        client.verificationCode.count(),
      );
      const memberships = await tenantPrismaService.runInUserContext(session.user.id, (client) =>
        client.membership.findMany(),
      );
      expect(refreshTokens).toBe(0);
      expect(codes).toBe(0);
      expect(memberships.every(({ status }) => status === 'left')).toBe(true);
    });

    it('keeps the consent evidence the law requires, now detached from any identity', async () => {
      const session = await signIn();

      await deleteAccount(session.accessToken, { password: PASSWORD, confirmation: 'ELIMINAR' });

      const consents = await tenantPrismaService.runInUserContext(session.user.id, (client) =>
        client.consent.count(),
      );
      expect(consents).toBe(3);
    });

    it('refuses an owner of an active center: it would leave it without a responsible person', async () => {
      const session = await signIn();
      const norte = await fixtures.createCenter('studio-norte', 'NORTE7');
      await fixtures.createMembership({ centerId: norte, userId: session.user.id, role: 'owner' });

      const response = await deleteAccount(session.accessToken, {
        password: PASSWORD,
        confirmation: 'ELIMINAR',
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ code: 'ACCOUNT_OWNS_CENTER' });
      expect((await login()).statusCode).toBe(200);
    });

    it.each([
      ['no confirmation', { password: PASSWORD }],
      ['a different confirmation word', { password: PASSWORD, confirmation: 'eliminar' }],
      ['no password', { confirmation: 'ELIMINAR' }],
    ])('refuses %s with 400 and keeps the account', async (_description, body) => {
      const session = await signIn();

      const response = await deleteAccount(session.accessToken, body);

      expect(response.statusCode).toBe(400);
      expect((await login()).statusCode).toBe(200);
    });

    it('asks for the password again: a wrong one deletes nothing', async () => {
      const session = await signIn();

      const response = await deleteAccount(session.accessToken, {
        password: 'not my password',
        confirmation: 'ELIMINAR',
      });

      expect(response.statusCode).toBe(403);
      expect((await login()).statusCode).toBe(200);
    });
  });
});
