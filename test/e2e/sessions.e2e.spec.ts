import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { BREACHED_PASSWORD_CHECKER } from '../../src/modules/auth/application/ports/breached-password.checker';
import { MAX_FAILED_LOGIN_ATTEMPTS } from '../../src/modules/auth/domain/login-policy';
import { hashRefreshToken } from '../../src/modules/auth/domain/refresh-token';
import { PrismaService } from '../../src/shared/database/prisma.service';
import { TenantPrismaService } from '../../src/shared/database/tenant-prisma.service';
import { EMAIL_SENDER } from '../../src/shared/email/email-sender';
import { FakeBreachedPasswordChecker, RecordingEmailSender } from '../support/auth-fakes';
import { GuardProbeModule } from '../support/guard-probe.module';
import { resetTestDatabase, runStatementAsOwnerForUser } from '../support/test-database';
import { createTestApplication } from './create-test-application';

const EMAIL = 'robin@yopmail.com';
const OTHER_EMAIL = 'otra@yopmail.com';
const PASSWORD = 'Nosnibor88';
const CONCURRENT_REQUEST_COUNT = 5;

interface SessionBody {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
  user: { id: string; email: string; fullName: string };
}

describe('sessions: login, refresh and logout', () => {
  let application: NestFastifyApplication;
  let prismaService: PrismaService;
  let tenantPrismaService: TenantPrismaService;
  const emails = new RecordingEmailSender();

  async function post(url: string, payload: unknown, headers: Record<string, string> = {}) {
    return application.inject({ method: 'POST', url, payload: payload as object, headers });
  }

  /** Crea una cuenta con el flujo real: registro, código por correo y verificación. */
  async function createVerifiedAccount(email: string): Promise<void> {
    await post('/v1/auth/register', {
      email,
      password: PASSWORD,
      fullName: 'Robin Rodríguez',
      consents: { privacy: true, terms: true },
    });
    await post('/v1/auth/email/verify', { email, code: emails.lastCodeSentTo(email) });
  }

  async function login(email = EMAIL, password = PASSWORD) {
    return post('/v1/auth/login', { email, password, deviceName: 'iPhone de Robin' });
  }

  async function loginSession(email = EMAIL): Promise<SessionBody> {
    return (await login(email)).json<SessionBody>();
  }

  async function activeRefreshTokenCount(): Promise<number> {
    return tenantPrismaService.runInPublicContext((client) =>
      client.refreshToken.count({ where: { revokedAt: null } }),
    );
  }

  beforeAll(async () => {
    application = await createTestApplication({
      extraModules: [GuardProbeModule],
      overrides: [
        { token: EMAIL_SENDER, value: emails },
        { token: BREACHED_PASSWORD_CHECKER, value: new FakeBreachedPasswordChecker() },
      ],
    });
    prismaService = application.get(PrismaService);
    tenantPrismaService = application.get(TenantPrismaService);
  });

  beforeEach(async () => {
    await resetTestDatabase();
    emails.sent.length = 0;
    await createVerifiedAccount(EMAIL);
  });

  afterAll(async () => {
    await application.close();
  });

  describe('POST /v1/auth/login', () => {
    it('opens a session: access token, refresh token and the person data', async () => {
      const response = await login();

      expect(response.statusCode).toBe(200);
      const session = response.json<SessionBody>();
      expect(session.accessToken.split('.')).toHaveLength(3);
      expect(session.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(session.user).toMatchObject({ email: EMAIL, fullName: 'Robin Rodríguez' });
    });

    it('gives an access token that the guards accept on a protected route', async () => {
      const session = await loginSession();

      const response = await application.inject({
        method: 'GET',
        url: '/v1/probe-guards/user',
        headers: { authorization: `Bearer ${session.accessToken}` },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ userId: session.user.id });
    });

    it('never returns the password hash or any internal field', async () => {
      const response = await login();

      expect(response.body).not.toContain('argon2');
      expect(response.body).not.toContain('passwordHash');
      expect(response.body).not.toContain('failedLoginCount');
    });

    it('is never cacheable (SEC-60)', async () => {
      const response = await login();

      expect(response.headers['cache-control']).toBe('no-store');
    });

    it('stores only the SHA-256 of the refresh token', async () => {
      const session = await loginSession();

      const [stored] = await tenantPrismaService.runInPublicContext((client) =>
        client.refreshToken.findMany(),
      );

      expect(stored?.tokenHash).toBe(hashRefreshToken(session.refreshToken));
      expect(JSON.stringify(stored)).not.toContain(session.refreshToken);
    });

    it('treats the email case-insensitively', async () => {
      const response = await login('  ROBIN@Yopmail.COM ');

      expect(response.statusCode).toBe(200);
    });

    it('answers a wrong password and an unknown email with the very same problem', async () => {
      const wrongPassword = await login(EMAIL, 'definitely not it');
      const unknownEmail = await login('nobody@yopmail.com', PASSWORD);

      const strip = (body: string): unknown => ({ ...JSON.parse(body), traceId: undefined });
      expect(wrongPassword.statusCode).toBe(401);
      expect(unknownEmail.statusCode).toBe(401);
      expect(strip(wrongPassword.body)).toEqual(strip(unknownEmail.body));
      expect(wrongPassword.json()).toMatchObject({ code: 'INVALID_CREDENTIALS' });
    });

    it('rejects an unconfirmed email only for someone who knows the password', async () => {
      await post('/v1/auth/register', {
        email: OTHER_EMAIL,
        password: PASSWORD,
        fullName: 'Otra Persona',
        consents: { privacy: true, terms: true },
      });

      const withPassword = await login(OTHER_EMAIL, PASSWORD);
      const withoutPassword = await login(OTHER_EMAIL, 'definitely not it');

      expect(withPassword.statusCode).toBe(403);
      expect(withPassword.json()).toMatchObject({ code: 'EMAIL_NOT_VERIFIED' });
      expect(withoutPassword.statusCode).toBe(401);
    });

    it.each([
      ['an unknown field', { extra: true }],
      ['no password', { password: undefined }],
      ['an invalid email', { email: 'nope' }],
    ])('rejects %s with 400', async (_description, overrides) => {
      const response = await post('/v1/auth/login', {
        email: EMAIL,
        password: PASSWORD,
        ...overrides,
      });

      expect(response.statusCode).toBe(400);
    });

    describe('lockout', () => {
      async function failTimes(times: number): Promise<void> {
        for (let attempt = 0; attempt < times; attempt += 1) await login(EMAIL, 'wrong password!!');
      }

      it(`locks the account after ${String(MAX_FAILED_LOGIN_ATTEMPTS)} failures, even for the right password`, async () => {
        await failTimes(MAX_FAILED_LOGIN_ATTEMPTS);

        const response = await login();

        expect(response.statusCode).toBe(401);
        expect(response.json()).toMatchObject({ code: 'INVALID_CREDENTIALS' });
      });

      it('emails the owner once when the lock starts, and the app never mentions it', async () => {
        emails.sent.length = 0;

        await failTimes(MAX_FAILED_LOGIN_ATTEMPTS + 2);

        expect(emails.messagesTo(EMAIL)).toHaveLength(1);
        expect(emails.messagesTo(EMAIL)[0]?.subject).toMatch(/bloqueado tu cuenta/i);
        expect((await login()).body).not.toMatch(/lock|bloque/i);
      });

      it('lets the person in once the lock has expired', async () => {
        await failTimes(MAX_FAILED_LOGIN_ATTEMPTS);
        const user = await prismaService.user.findUniqueOrThrow({ where: { email: EMAIL } });
        await runStatementAsOwnerForUser(
          user.id,
          `update users set locked_until = now() - interval '1 minute' where id = '${user.id}'`,
        );

        const response = await login();

        expect(response.statusCode).toBe(200);
      });

      it('sets a lock about 15 minutes ahead on the database clock', async () => {
        await failTimes(MAX_FAILED_LOGIN_ATTEMPTS);

        const [row] = await prismaService.$queryRaw<{ minutes: number }[]>`
          select (extract(epoch from (locked_until - now())) / 60)::float as minutes from users`;

        expect(row?.minutes).toBeGreaterThan(14);
        expect(row?.minutes).toBeLessThanOrEqual(15);
      });
    });
  });

  describe('POST /v1/auth/refresh', () => {
    async function refresh(refreshToken: string) {
      return post('/v1/auth/refresh', { refreshToken });
    }

    it('rotates the refresh token and issues a new access token', async () => {
      const session = await loginSession();

      const response = await refresh(session.refreshToken);

      expect(response.statusCode).toBe(200);
      const renewed = response.json<Omit<SessionBody, 'user'>>();
      expect(renewed.refreshToken).not.toBe(session.refreshToken);
      expect(renewed.accessToken.split('.')).toHaveLength(3);
      expect(response.body).not.toContain('"user"');
    });

    it('lets the renewed refresh token be used again, as a chain', async () => {
      const first = await loginSession();
      const second = (await refresh(first.refreshToken)).json<{ refreshToken: string }>();

      const third = await refresh(second.refreshToken);

      expect(third.statusCode).toBe(200);
    });

    it('rejects a token that was already rotated, and revokes the whole session (token theft)', async () => {
      const first = await loginSession();
      const second = (await refresh(first.refreshToken)).json<{ refreshToken: string }>();

      const replay = await refresh(first.refreshToken);
      const newestToken = await refresh(second.refreshToken);

      expect(replay.statusCode).toBe(401);
      expect(replay.json()).toMatchObject({ code: 'SESSION_INVALID' });
      expect(newestToken.statusCode).toBe(401);
      expect(await activeRefreshTokenCount()).toBe(0);
    });

    it('keeps the person other devices signed in after a theft on one of them', async () => {
      const stolen = await loginSession();
      const otherDevice = await loginSession();
      await refresh(stolen.refreshToken);
      await refresh(stolen.refreshToken);

      const response = await refresh(otherDevice.refreshToken);

      expect(response.statusCode).toBe(200);
    });

    it('lets exactly one of many simultaneous refreshes win and revokes the session as reuse', async () => {
      const session = await loginSession();

      const responses = await Promise.all(
        Array.from({ length: CONCURRENT_REQUEST_COUNT }, () => refresh(session.refreshToken)),
      );

      expect(responses.filter((response) => response.statusCode === 200)).toHaveLength(1);
      expect(await activeRefreshTokenCount()).toBe(0);
    });

    it('rejects an unknown but well-formed token with 401 SESSION_INVALID', async () => {
      const response = await refresh('A'.repeat(43));

      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({ code: 'SESSION_INVALID' });
    });

    it.each(['', 'has spaces in it', 'x'.repeat(200), 'ñandú'])(
      'rejects the malformed token %p with 400 before touching the database',
      async (token) => {
        const response = await refresh(token);

        expect(response.statusCode).toBe(400);
      },
    );

    it('rejects an expired token', async () => {
      const session = await loginSession();
      const user = await prismaService.user.findUniqueOrThrow({ where: { email: EMAIL } });
      await tenantPrismaService.runInPublicContext((client) =>
        client.refreshToken.updateMany({
          where: { userId: user.id },
          data: { expiresAt: new Date(Date.now() - 1_000) },
        }),
      );

      const response = await refresh(session.refreshToken);

      expect(response.statusCode).toBe(401);
    });
  });

  describe('POST /v1/auth/logout', () => {
    async function logout(accessToken: string | undefined, body: unknown) {
      return post(
        '/v1/auth/logout',
        body,
        accessToken ? { authorization: `Bearer ${accessToken}` } : {},
      );
    }

    it('requires being signed in', async () => {
      const response = await logout(undefined, {});

      expect(response.statusCode).toBe(401);
    });

    it('closes the session of this device: its refresh token stops working', async () => {
      const session = await loginSession();

      const response = await logout(session.accessToken, { refreshToken: session.refreshToken });
      const afterwards = await post('/v1/auth/refresh', { refreshToken: session.refreshToken });

      expect(response.statusCode).toBe(204);
      expect(afterwards.statusCode).toBe(401);
    });

    it('leaves the other devices signed in', async () => {
      const phone = await loginSession();
      const tablet = await loginSession();

      await logout(phone.accessToken, { refreshToken: phone.refreshToken });

      const stillWorks = await post('/v1/auth/refresh', { refreshToken: tablet.refreshToken });
      expect(stillWorks.statusCode).toBe(200);
    });

    it('signs out of every device with everywhere=true', async () => {
      const phone = await loginSession();
      await loginSession();

      await logout(phone.accessToken, { everywhere: true });

      expect(await activeRefreshTokenCount()).toBe(0);
    });

    it('never lets someone revoke another person session, even with a valid token of theirs', async () => {
      await createVerifiedAccount(OTHER_EMAIL);
      const attacker = await loginSession(OTHER_EMAIL);
      const victim = await loginSession(EMAIL);

      await logout(attacker.accessToken, { refreshToken: victim.refreshToken });

      const victimStillWorks = await post('/v1/auth/refresh', {
        refreshToken: victim.refreshToken,
      });
      expect(victimStillWorks.statusCode).toBe(200);
    });

    it('answers 204 for an unknown token, so it cannot be used to probe tokens', async () => {
      const session = await loginSession();

      const response = await logout(session.accessToken, { refreshToken: 'B'.repeat(43) });

      expect(response.statusCode).toBe(204);
    });
  });
});
