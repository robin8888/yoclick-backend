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
const PASSWORD = 'correct horse battery staple';
const BREACHED_PASSWORD = 'password123456';
const CONCURRENT_REQUEST_COUNT = 5;
const PROBLEM_CONTENT_TYPE = 'application/problem+json';

const validRegistration = {
  email: EMAIL,
  password: PASSWORD,
  fullName: 'Robin Rodríguez',
  consents: { privacy: true, terms: true, marketing: false },
};

describe('registration and email verification', () => {
  let application: NestFastifyApplication;
  let prismaService: PrismaService;
  let tenantPrismaService: TenantPrismaService;
  const emails = new RecordingEmailSender();

  async function post(url: string, payload: unknown): ReturnType<typeof application.inject> {
    return application.inject({ method: 'POST', url, payload: payload as object });
  }

  async function register(overrides: Record<string, unknown> = {}) {
    return post('/v1/auth/register', { ...validRegistration, ...overrides });
  }

  async function userIdOf(email: string): Promise<string> {
    return (await prismaService.user.findUniqueOrThrow({ where: { email } })).id;
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
  });

  afterAll(async () => {
    await application.close();
  });

  describe('POST /v1/auth/register', () => {
    it('creates an unverified account and answers 202 with a fixed body', async () => {
      const response = await register();

      expect(response.statusCode).toBe(202);
      expect(response.json()).toEqual({ status: 'verification_sent' });
      const account = await prismaService.user.findUniqueOrThrow({ where: { email: EMAIL } });
      expect(account.emailVerifiedAt).toBeNull();
      expect(account.fullName).toBe('Robin Rodríguez');
    });

    it('stores an argon2id hash and never the password', async () => {
      await register();

      const account = await prismaService.user.findUniqueOrThrow({ where: { email: EMAIL } });

      expect(account.passwordHash).toMatch(/^\$argon2id\$/);
      expect(account.passwordHash).not.toContain(PASSWORD);
    });

    it('records the three consents with the legal version, the declined one included', async () => {
      await register();
      const userId = await userIdOf(EMAIL);

      const consents = await tenantPrismaService.runInUserContext(userId, (client) =>
        client.consent.findMany(),
      );

      // El orden de un enum en PostgreSQL es el de su declaración, no el alfabético: se ordena aquí.
      const grantedByKind = consents
        .map(({ kind, isGranted }) => ({ kind, isGranted }))
        .sort((first, second) => first.kind.localeCompare(second.kind));
      expect(grantedByKind).toEqual([
        { kind: 'marketing', isGranted: false },
        { kind: 'privacy', isGranted: true },
        { kind: 'terms', isGranted: true },
      ]);
      expect(consents.every((consent) => consent.version === '2026-10-01')).toBe(true);
    });

    it('keeps a hash of the IP as consent evidence, not the IP itself', async () => {
      await register();
      const userId = await userIdOf(EMAIL);

      const [consent] = await tenantPrismaService.runInUserContext(userId, (client) =>
        client.consent.findMany({ take: 1 }),
      );

      expect(consent?.ipHash).toMatch(/^[0-9a-f]{64}$/);
      expect(consent?.ipHash).not.toContain('127.0.0.1');
    });

    it('makes consents immutable at the database level: the API role cannot update or delete them', async () => {
      await register();
      const userId = await userIdOf(EMAIL);

      const rewrite = tenantPrismaService.runInUserContext(userId, (client) =>
        client.consent.updateMany({ data: { isGranted: false } }),
      );
      const erase = tenantPrismaService.runInUserContext(userId, (client) =>
        client.consent.deleteMany(),
      );

      await expect(rewrite).rejects.toThrow();
      await expect(erase).rejects.toThrow();
    });

    it('stores only a keyed hash of the code, never the code', async () => {
      await register();
      const code = emails.lastCodeSentTo(EMAIL) ?? '';
      const userId = await userIdOf(EMAIL);

      const [stored] = await tenantPrismaService.runInUserContext(userId, (client) =>
        client.verificationCode.findMany(),
      );

      expect(code).toMatch(/^\d{6}$/);
      expect(stored?.codeHash).toMatch(/^[0-9a-f]{64}$/);
      expect(stored?.codeHash).not.toContain(code);
    });

    it('emails the code to the registered address, with the password nowhere in it', async () => {
      await register();

      expect(emails.messagesTo(EMAIL)).toHaveLength(1);
      expect(JSON.stringify(emails.sent)).not.toContain(PASSWORD);
    });

    it('treats the email case-insensitively: ROBIN@Yopmail.com is the same account', async () => {
      await register();
      await register({ email: 'ROBIN@Yopmail.COM ' });

      expect(await prismaService.user.count()).toBe(1);
    });

    it('answers exactly the same for an email that already has a verified account', async () => {
      await register();
      await post('/v1/auth/email/verify', { email: EMAIL, code: emails.lastCodeSentTo(EMAIL) });
      const first = await register({ password: 'another long passphrase' });

      const newPerson = await register({ email: 'otra@yopmail.com' });

      expect(first.statusCode).toBe(newPerson.statusCode);
      expect(first.body).toBe(newPerson.body);
    });

    it('never lets a second registration change the owner password', async () => {
      await register();
      const before = await prismaService.user.findUniqueOrThrow({ where: { email: EMAIL } });

      await register({ password: 'attacker chosen passphrase', fullName: 'Attacker' });

      const after = await prismaService.user.findUniqueOrThrow({ where: { email: EMAIL } });
      expect(after.passwordHash).toBe(before.passwordHash);
      expect(after.fullName).toBe('Robin Rodríguez');
    });

    it('creates exactly one account when the same email registers many times at once', async () => {
      const responses = await Promise.all(
        Array.from({ length: CONCURRENT_REQUEST_COUNT }, () => register()),
      );

      expect(responses.every((response) => response.statusCode === 202)).toBe(true);
      expect(await prismaService.user.count()).toBe(1);
    });

    it('answers CONSENT_REQUIRED without the privacy consent, and creates nothing', async () => {
      const response = await register({ consents: { privacy: false, terms: true } });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ code: 'CONSENT_REQUIRED' });
      expect(await prismaService.user.count()).toBe(0);
    });

    it('rejects a short password naming the field, without echoing it', async () => {
      const response = await register({ password: 'short' });

      expect(response.statusCode).toBe(400);
      expect(response.headers['content-type']).toContain(PROBLEM_CONTENT_TYPE);
      expect(response.json<{ errors: unknown[] }>().errors).toContainEqual({
        path: 'password',
        code: 'too_short',
      });
      expect(response.body).not.toContain('"short"');
    });

    it('rejects a breached password with 422 PASSWORD_BREACHED', async () => {
      const response = await register({ password: BREACHED_PASSWORD });

      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({ code: 'PASSWORD_BREACHED' });
    });

    it.each([
      ['an unknown field such as role', { role: 'owner' }],
      ['an invalid email', { email: 'not-an-email' }],
      ['an empty name', { fullName: ' ' }],
      ['a missing consents object', { consents: undefined }],
    ])('rejects %s with 400 VALIDATION_FAILED', async (_description, overrides) => {
      const response = await register(overrides);

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
      expect(await prismaService.user.count()).toBe(0);
    });
  });

  describe('POST /v1/auth/email/verify', () => {
    async function registerAndGetCode(): Promise<string> {
      await register();
      return emails.lastCodeSentTo(EMAIL) ?? '';
    }

    it('verifies the email with the emailed code', async () => {
      const code = await registerAndGetCode();

      const response = await post('/v1/auth/email/verify', { email: EMAIL, code });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: 'verified' });
      const account = await prismaService.user.findUniqueOrThrow({ where: { email: EMAIL } });
      expect(account.emailVerifiedAt).toBeInstanceOf(Date);
    });

    it('accepts the code only once', async () => {
      const code = await registerAndGetCode();
      await post('/v1/auth/email/verify', { email: EMAIL, code });

      const reuse = await post('/v1/auth/email/verify', { email: EMAIL, code });

      expect(reuse.statusCode).toBe(400);
      expect(reuse.json()).toMatchObject({ code: 'VERIFICATION_CODE_INVALID' });
    });

    it('lets exactly one of many simultaneous requests with the right code succeed', async () => {
      const code = await registerAndGetCode();

      const responses = await Promise.all(
        Array.from({ length: CONCURRENT_REQUEST_COUNT }, () =>
          post('/v1/auth/email/verify', { email: EMAIL, code }),
        ),
      );

      expect(responses.filter((response) => response.statusCode === 200)).toHaveLength(1);
    });

    it(`locks the code after ${String(MAX_VERIFICATION_ATTEMPTS)} wrong attempts, even for the right code`, async () => {
      const code = await registerAndGetCode();
      const wrongCode = code === '000000' ? '000001' : '000000';
      for (let attempt = 0; attempt < MAX_VERIFICATION_ATTEMPTS; attempt += 1) {
        await post('/v1/auth/email/verify', { email: EMAIL, code: wrongCode });
      }

      const response = await post('/v1/auth/email/verify', { email: EMAIL, code });

      expect(response.statusCode).toBe(400);
      const account = await prismaService.user.findUniqueOrThrow({ where: { email: EMAIL } });
      expect(account.emailVerifiedAt).toBeNull();
    });

    it('rejects an expired code', async () => {
      const code = await registerAndGetCode();
      await runStatementAsOwnerForUser(
        await userIdOf(EMAIL),
        "update verification_codes set expires_at = now() - interval '1 minute'",
      );

      const response = await post('/v1/auth/email/verify', { email: EMAIL, code });

      expect(response.statusCode).toBe(400);
    });

    it('answers an unknown email exactly like a wrong code', async () => {
      await registerAndGetCode();

      const unknown = await post('/v1/auth/email/verify', {
        email: 'nobody@yopmail.com',
        code: '123456',
      });
      const wrong = await post('/v1/auth/email/verify', { email: EMAIL, code: '000000' });

      expect(unknown.statusCode).toBe(wrong.statusCode);
      expect(unknown.json()).toMatchObject({ code: 'VERIFICATION_CODE_INVALID' });
    });

    it.each(['12345', '1234567', 'abcdef', ''])('rejects the malformed code %p', async (code) => {
      const response = await post('/v1/auth/email/verify', { email: EMAIL, code });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('POST /v1/auth/email/resend', () => {
    it('answers 202 for any email, existing or not', async () => {
      await register();

      const known = await post('/v1/auth/email/resend', { email: EMAIL });
      const unknown = await post('/v1/auth/email/resend', { email: 'nobody@yopmail.com' });

      expect(known.statusCode).toBe(202);
      expect(known.body).toBe(unknown.body);
    });

    it('does not send a second email while the first code is recent', async () => {
      await register();
      emails.sent.length = 0;

      await post('/v1/auth/email/resend', { email: EMAIL });

      expect(emails.sent).toHaveLength(0);
    });

    it('sends a new code once the cooldown has passed, and the old one stops working', async () => {
      await register();
      const oldCode = emails.lastCodeSentTo(EMAIL) ?? '';
      await runStatementAsOwnerForUser(
        await userIdOf(EMAIL),
        "update verification_codes set created_at = now() - interval '5 minutes'",
      );
      emails.sent.length = 0;

      await post('/v1/auth/email/resend', { email: EMAIL });
      const newCode = emails.lastCodeSentTo(EMAIL) ?? '';
      const withOld = await post('/v1/auth/email/verify', { email: EMAIL, code: oldCode });
      const withNew = await post('/v1/auth/email/verify', { email: EMAIL, code: newCode });

      expect(newCode).not.toBe(oldCode);
      expect(withOld.statusCode).toBe(400);
      expect(withNew.statusCode).toBe(200);
    });
  });

  describe('isolation of personal data (RLS)', () => {
    it("does not let another person read someone's consents or codes", async () => {
      await register();
      await register({ email: 'otra@yopmail.com', fullName: 'Otra Persona' });
      const otherUserId = await userIdOf('otra@yopmail.com');

      const consents = await tenantPrismaService.runInUserContext(otherUserId, (client) =>
        client.consent.findMany(),
      );
      const codes = await tenantPrismaService.runInUserContext(otherUserId, (client) =>
        client.verificationCode.findMany(),
      );

      expect(consents.every((consent) => consent.userId === otherUserId)).toBe(true);
      expect(codes.every((code) => code.userId === otherUserId)).toBe(true);
      expect(consents).toHaveLength(3);
      expect(codes).toHaveLength(1);
    });
  });
});
