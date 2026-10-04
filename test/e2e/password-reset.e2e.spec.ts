import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { BREACHED_PASSWORD_CHECKER } from '../../src/modules/auth/application/ports/breached-password.checker';
import { MAX_VERIFICATION_ATTEMPTS } from '../../src/modules/auth/domain/verification-code';
import { PrismaService } from '../../src/shared/database/prisma.service';
import { TenantPrismaService } from '../../src/shared/database/tenant-prisma.service';
import { EMAIL_SENDER } from '../../src/shared/email/email-sender';
import { FakeBreachedPasswordChecker, RecordingEmailSender } from '../support/auth-fakes';
import { resetTestDatabase, runStatementAsOwnerForUser } from '../support/test-database';
import { createTestApplication } from './create-test-application';

const EMAIL = 'robin@yopmail.com';
const OLD_PASSWORD = 'Nosnibor88';
const NEW_PASSWORD = 'a brand new passphrase 2026';
const BREACHED_PASSWORD = 'password123456';
const CONCURRENT_REQUEST_COUNT = 5;

describe('password recovery', () => {
  let application: NestFastifyApplication;
  let prismaService: PrismaService;
  let tenantPrismaService: TenantPrismaService;
  const emails = new RecordingEmailSender();

  async function post(url: string, payload: unknown) {
    return application.inject({ method: 'POST', url, payload: payload as object });
  }

  async function login(password: string) {
    return post('/v1/auth/login', { email: EMAIL, password });
  }

  async function requestResetCode(): Promise<string> {
    await post('/v1/auth/password/forgot', { email: EMAIL });
    return emails.lastCodeSentTo(EMAIL) ?? '';
  }

  async function reset(code: string, newPassword = NEW_PASSWORD) {
    return post('/v1/auth/password/reset', { email: EMAIL, code, newPassword });
  }

  beforeAll(async () => {
    application = await createTestApplication({
      overrides: [
        { token: EMAIL_SENDER, value: emails },
        {
          token: BREACHED_PASSWORD_CHECKER,
          value: new FakeBreachedPasswordChecker([BREACHED_PASSWORD]),
        },
      ],
    });
    prismaService = application.get(PrismaService);
    tenantPrismaService = application.get(TenantPrismaService);
  });

  beforeEach(async () => {
    await resetTestDatabase();
    emails.sent.length = 0;
    await post('/v1/auth/register', {
      email: EMAIL,
      password: OLD_PASSWORD,
      fullName: 'Robin Rodríguez',
      consents: { privacy: true, terms: true },
    });
    await post('/v1/auth/email/verify', { email: EMAIL, code: emails.lastCodeSentTo(EMAIL) });
    emails.sent.length = 0;
  });

  afterAll(async () => {
    await application.close();
  });

  describe('POST /v1/auth/password/forgot', () => {
    it('answers 202 with a fixed body and emails a reset code', async () => {
      const response = await post('/v1/auth/password/forgot', { email: EMAIL });

      expect(response.statusCode).toBe(202);
      expect(response.json()).toEqual({ status: 'reset_requested' });
      expect(emails.lastCodeSentTo(EMAIL)).toMatch(/^\d{6}$/);
    });

    it('answers exactly the same for an email that has no account', async () => {
      const known = await post('/v1/auth/password/forgot', { email: EMAIL });
      const unknown = await post('/v1/auth/password/forgot', { email: 'nobody@yopmail.com' });

      expect(unknown.statusCode).toBe(known.statusCode);
      expect(unknown.body).toBe(known.body);
      expect(emails.messagesTo('nobody@yopmail.com')).toHaveLength(0);
    });

    it('stores only a keyed hash of the reset code', async () => {
      const code = await requestResetCode();
      const user = await prismaService.user.findUniqueOrThrow({ where: { email: EMAIL } });

      const [stored] = await tenantPrismaService.runInUserContext(user.id, (client) =>
        client.verificationCode.findMany({ where: { purpose: 'password_reset' } }),
      );

      expect(stored?.codeHash).toMatch(/^[0-9a-f]{64}$/);
      expect(stored?.codeHash).not.toContain(code);
    });

    it('gives the code 30 minutes, longer than the 15 of email verification', async () => {
      await requestResetCode();
      const user = await prismaService.user.findUniqueOrThrow({ where: { email: EMAIL } });

      // La tabla tiene RLS por persona: se consulta dentro del contexto de su dueña.
      const [row] = await tenantPrismaService.runInUserContext(
        user.id,
        (client) =>
          client.$queryRaw<{ minutes: number }[]>`
            select (extract(epoch from (expires_at - now())) / 60)::float as minutes
            from verification_codes where purpose = 'password_reset'`,
      );

      expect(row?.minutes).toBeGreaterThan(29);
      expect(row?.minutes).toBeLessThanOrEqual(30);
    });
  });

  describe('POST /v1/auth/password/reset', () => {
    it('changes the password: the new one logs in and the old one no longer does', async () => {
      const code = await requestResetCode();

      const response = await reset(code);

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: 'password_changed' });
      expect((await login(NEW_PASSWORD)).statusCode).toBe(200);
      expect((await login(OLD_PASSWORD)).statusCode).toBe(401);
    });

    it('signs the person out everywhere: an old refresh token stops working', async () => {
      const { refreshToken } = (await login(OLD_PASSWORD)).json<{ refreshToken: string }>();
      const code = await requestResetCode();

      await reset(code);

      const refresh = await post('/v1/auth/refresh', { refreshToken });
      expect(refresh.statusCode).toBe(401);
    });

    it('emails the owner that the password changed, without any password in it', async () => {
      const code = await requestResetCode();
      emails.sent.length = 0;

      await reset(code);

      const [notice] = emails.messagesTo(EMAIL);
      expect(notice?.subject).toMatch(/contraseña se ha cambiado/i);
      expect(JSON.stringify(emails.sent)).not.toContain(NEW_PASSWORD);
      expect(JSON.stringify(emails.sent)).not.toContain(OLD_PASSWORD);
    });

    it('lifts a lockout, so a locked-out owner can recover the account', async () => {
      for (let attempt = 0; attempt < 10; attempt += 1) await login('wrong password!!');
      const code = await requestResetCode();

      await reset(code);

      expect((await login(NEW_PASSWORD)).statusCode).toBe(200);
    });

    it('accepts the code only once', async () => {
      const code = await requestResetCode();
      await reset(code);

      const reuse = await reset(code, 'yet another passphrase 77');

      expect(reuse.statusCode).toBe(400);
      expect(reuse.json()).toMatchObject({ code: 'VERIFICATION_CODE_INVALID' });
      expect((await login(NEW_PASSWORD)).statusCode).toBe(200);
    });

    it('lets exactly one of many simultaneous resets with the right code succeed', async () => {
      const code = await requestResetCode();

      const responses = await Promise.all(
        Array.from({ length: CONCURRENT_REQUEST_COUNT }, (_, index) =>
          reset(code, `${NEW_PASSWORD} ${String(index)}`),
        ),
      );

      expect(responses.filter((response) => response.statusCode === 200)).toHaveLength(1);
    });

    it(`locks the code after ${String(MAX_VERIFICATION_ATTEMPTS)} wrong attempts`, async () => {
      const code = await requestResetCode();
      const wrongCode = code === '000000' ? '000001' : '000000';
      for (let attempt = 0; attempt < MAX_VERIFICATION_ATTEMPTS; attempt += 1) {
        await reset(wrongCode);
      }

      const response = await reset(code);

      expect(response.statusCode).toBe(400);
      expect((await login(OLD_PASSWORD)).statusCode).toBe(200);
    });

    it('rejects an expired code', async () => {
      const code = await requestResetCode();
      const user = await prismaService.user.findUniqueOrThrow({ where: { email: EMAIL } });
      await runStatementAsOwnerForUser(
        user.id,
        "update verification_codes set expires_at = now() - interval '1 minute'",
      );

      const response = await reset(code);

      expect(response.statusCode).toBe(400);
    });

    it('answers an unknown email exactly like a wrong code', async () => {
      await requestResetCode();

      const unknown = await post('/v1/auth/password/reset', {
        email: 'nobody@yopmail.com',
        code: '123456',
        newPassword: NEW_PASSWORD,
      });
      const wrong = await reset('000000');

      expect(unknown.statusCode).toBe(wrong.statusCode);
      expect(unknown.json()).toMatchObject({ code: 'VERIFICATION_CODE_INVALID' });
    });

    it('rejects a weak new password naming newPassword, and keeps the code usable', async () => {
      const code = await requestResetCode();

      const weak = await reset(code, 'short');
      const retry = await reset(code, NEW_PASSWORD);

      expect(weak.statusCode).toBe(400);
      expect(weak.json<{ errors: unknown[] }>().errors).toContainEqual({
        path: 'newPassword',
        code: 'too_short',
      });
      expect(retry.statusCode).toBe(200);
    });

    it('rejects a breached new password with 422 and keeps the old password', async () => {
      const code = await requestResetCode();

      const response = await reset(code, BREACHED_PASSWORD);

      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({ code: 'PASSWORD_BREACHED' });
      expect((await login(OLD_PASSWORD)).statusCode).toBe(200);
    });

    it.each([
      ['an unknown field', { extra: 1 }],
      ['a non-numeric code', { code: 'abcdef' }],
      ['a short code', { code: '123' }],
    ])('rejects %s with 400', async (_description, overrides) => {
      const response = await post('/v1/auth/password/reset', {
        email: EMAIL,
        code: '123456',
        newPassword: NEW_PASSWORD,
        ...overrides,
      });

      expect(response.statusCode).toBe(400);
    });
  });
});
