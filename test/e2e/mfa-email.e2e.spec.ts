import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import * as OTPAuth from 'otpauth';
import { BREACHED_PASSWORD_CHECKER } from '../../src/modules/auth/application/ports/breached-password.checker';
import { PrismaService } from '../../src/shared/database/prisma.service';
import { EMAIL_SENDER } from '../../src/shared/email/email-sender';
import { FakeBreachedPasswordChecker, RecordingEmailSender } from '../support/auth-fakes';
import { resetTestDatabase, runStatementAsOwnerForUser } from '../support/test-database';
import { createTestApplication } from './create-test-application';

const EMAIL = 'robin@yopmail.com';
const PASSWORD = 'Nosnibor88';
const EMAIL_HINT = 'r***@yopmail.com';

interface SessionBody {
  status: string;
  accessToken: string;
  mfaToken?: string;
  methods?: string[];
  emailHint?: string;
}

describe('second factor by email code', () => {
  let application: NestFastifyApplication;
  let prismaService: PrismaService;
  const emails = new RecordingEmailSender();

  async function send(
    method: 'GET' | 'POST',
    url: string,
    payload?: unknown,
    accessToken?: string,
  ) {
    return application.inject({
      method,
      url,
      ...(payload === undefined ? {} : { payload: payload as object }),
      headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {},
    });
  }

  async function registerAndLogin(): Promise<SessionBody> {
    await send('POST', '/v1/auth/register', {
      email: EMAIL,
      password: PASSWORD,
      fullName: 'Robin Rodríguez',
      consents: { privacy: true, terms: true },
    });
    await send('POST', '/v1/auth/email/verify', {
      email: EMAIL,
      code: emails.lastCodeSentTo(EMAIL),
    });
    return (await send('POST', '/v1/auth/login', { email: EMAIL, password: PASSWORD })).json();
  }

  async function userId(): Promise<string> {
    return (await prismaService.user.findUniqueOrThrow({ where: { email: EMAIL } })).id;
  }

  /** Salta el enfriamiento de 60 s sin esperar: envejece los códigos ya emitidos. */
  async function ageCodes(): Promise<void> {
    await runStatementAsOwnerForUser(
      await userId(),
      "update verification_codes set created_at = now() - interval '2 minutes' where purpose = 'mfa_email'",
    );
  }

  async function enrollEmailFactor(accessToken: string): Promise<string[]> {
    const setup = await send('POST', '/v1/me/mfa/email/setup', { password: PASSWORD }, accessToken);
    expect(setup.statusCode).toBe(200);
    const confirmation = await send(
      'POST',
      '/v1/me/mfa/email/confirm',
      { code: emails.lastCodeSentTo(EMAIL) },
      accessToken,
    );
    expect(confirmation.statusCode).toBe(200);
    await ageCodes();
    return confirmation.json<{ recoveryCodes: string[] }>().recoveryCodes;
  }

  async function startLoginChallenge(): Promise<string> {
    const response = await send('POST', '/v1/auth/login', { email: EMAIL, password: PASSWORD });
    return response.json<SessionBody>().mfaToken as string;
  }

  beforeAll(async () => {
    application = await createTestApplication({
      overrides: [
        { token: EMAIL_SENDER, value: emails },
        { token: BREACHED_PASSWORD_CHECKER, value: new FakeBreachedPasswordChecker() },
      ],
    });
    prismaService = application.get(PrismaService);
  });

  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterAll(async () => {
    await application.close();
  });

  describe('enrolment', () => {
    it('asks for the password before sending the code', async () => {
      const session = await registerAndLogin();
      const sentBefore = emails.sent.length;

      const response = await send(
        'POST',
        '/v1/me/mfa/email/setup',
        { password: 'Incorrecta123' },
        session.accessToken,
      );

      expect(response.statusCode).toBe(403);
      expect(emails.sent).toHaveLength(sentBefore);
    });

    it('sends a code, activates the method with it and reports it in the status', async () => {
      const session = await registerAndLogin();

      const recoveryCodes = await enrollEmailFactor(session.accessToken);
      const status = await send('GET', '/v1/me/mfa', undefined, session.accessToken);

      expect(recoveryCodes).toHaveLength(10);
      expect(status.json()).toEqual({
        isEnabled: true,
        method: 'email',
        emailHint: EMAIL_HINT,
        recoveryCodesRemaining: 10,
      });
    });

    it('rejects a wrong code and does not activate', async () => {
      const session = await registerAndLogin();
      await send('POST', '/v1/me/mfa/email/setup', { password: PASSWORD }, session.accessToken);
      const sentCode = emails.lastCodeSentTo(EMAIL);

      const response = await send(
        'POST',
        '/v1/me/mfa/email/confirm',
        { code: sentCode === '000000' ? '111111' : '000000' },
        session.accessToken,
      );

      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ code: 'MFA_CODE_INVALID' });
      const status = await send('GET', '/v1/me/mfa', undefined, session.accessToken);
      expect(status.json()).toMatchObject({ isEnabled: false, method: null });
    });

    it('answers 429 RATE_LIMITED when a second code is requested within 60 seconds', async () => {
      const session = await registerAndLogin();
      await send('POST', '/v1/me/mfa/email/setup', { password: PASSWORD }, session.accessToken);

      const again = await send(
        'POST',
        '/v1/me/mfa/email/setup',
        { password: PASSWORD },
        session.accessToken,
      );

      expect(again.statusCode).toBe(429);
      expect(again.json()).toMatchObject({ code: 'RATE_LIMITED' });
    });

    it('requires authentication', async () => {
      const response = await send('POST', '/v1/me/mfa/email/setup', { password: PASSWORD });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('signing in', () => {
    it('lists the methods and the masked email in the challenge', async () => {
      const session = await registerAndLogin();
      await enrollEmailFactor(session.accessToken);

      const response = await send('POST', '/v1/auth/login', { email: EMAIL, password: PASSWORD });

      expect(response.json()).toMatchObject({
        status: 'mfa_required',
        methods: ['email'],
        emailHint: EMAIL_HINT,
      });
    });

    it('signs in with the emailed code and refuses to reuse it', async () => {
      const session = await registerAndLogin();
      await enrollEmailFactor(session.accessToken);
      const mfaToken = await startLoginChallenge();

      const sent = await send('POST', '/v1/auth/mfa/email/send', { mfaToken });
      const code = emails.lastCodeSentTo(EMAIL);
      const verified = await send('POST', '/v1/auth/mfa/verify', { mfaToken, emailCode: code });
      const reused = await send('POST', '/v1/auth/mfa/verify', { mfaToken, emailCode: code });

      expect(sent.statusCode).toBe(200);
      expect(sent.json()).toMatchObject({ emailHint: EMAIL_HINT });
      expect(verified.statusCode).toBe(200);
      expect(verified.json()).toMatchObject({ status: 'authenticated' });
      expect(reused.statusCode).toBe(401);
    });

    it('invalidates the code after five wrong attempts, even for the right one', async () => {
      const session = await registerAndLogin();
      await enrollEmailFactor(session.accessToken);
      const mfaToken = await startLoginChallenge();
      await send('POST', '/v1/auth/mfa/email/send', { mfaToken });
      const rightCode = emails.lastCodeSentTo(EMAIL) as string;
      const wrongCode = rightCode === '000000' ? '111111' : '000000';

      for (let attempt = 0; attempt < 5; attempt += 1) {
        const failed = await send('POST', '/v1/auth/mfa/verify', {
          mfaToken,
          emailCode: wrongCode,
        });
        expect(failed.statusCode).toBe(401);
      }
      const late = await send('POST', '/v1/auth/mfa/verify', { mfaToken, emailCode: rightCode });

      expect(late.statusCode).toBe(401);
      expect(late.json()).toMatchObject({ code: 'MFA_CODE_INVALID' });
    });

    it('rejects an expired code', async () => {
      const session = await registerAndLogin();
      await enrollEmailFactor(session.accessToken);
      const mfaToken = await startLoginChallenge();
      await send('POST', '/v1/auth/mfa/email/send', { mfaToken });
      const code = emails.lastCodeSentTo(EMAIL);
      await runStatementAsOwnerForUser(
        await userId(),
        "update verification_codes set expires_at = now() - interval '1 minute' where purpose = 'mfa_email'",
      );

      const response = await send('POST', '/v1/auth/mfa/verify', { mfaToken, emailCode: code });

      expect(response.statusCode).toBe(401);
    });

    it('answers 429 when the code is requested again too soon, and accepts only the newest after that', async () => {
      const session = await registerAndLogin();
      await enrollEmailFactor(session.accessToken);
      const mfaToken = await startLoginChallenge();
      await send('POST', '/v1/auth/mfa/email/send', { mfaToken });
      const firstCode = emails.lastCodeSentTo(EMAIL) as string;

      const tooSoon = await send('POST', '/v1/auth/mfa/email/send', { mfaToken });
      await ageCodes();
      const resent = await send('POST', '/v1/auth/mfa/email/send', { mfaToken });
      const secondCode = emails.lastCodeSentTo(EMAIL) as string;

      expect(tooSoon.statusCode).toBe(429);
      expect(tooSoon.json()).toMatchObject({ code: 'RATE_LIMITED' });
      expect(resent.statusCode).toBe(200);
      if (firstCode !== secondCode) {
        const stale = await send('POST', '/v1/auth/mfa/verify', { mfaToken, emailCode: firstCode });
        expect(stale.statusCode).toBe(401);
      }
      const fresh = await send('POST', '/v1/auth/mfa/verify', { mfaToken, emailCode: secondCode });
      expect(fresh.statusCode).toBe(200);
    });

    it('rejects an invalid challenge token', async () => {
      const response = await send('POST', '/v1/auth/mfa/email/send', { mfaToken: 'not-a-token' });

      expect(response.statusCode).toBe(401);
    });

    it('accepts a recovery code for someone who chose the email method', async () => {
      const session = await registerAndLogin();
      const recoveryCodes = await enrollEmailFactor(session.accessToken);
      const mfaToken = await startLoginChallenge();

      const response = await send('POST', '/v1/auth/mfa/verify', {
        mfaToken,
        recoveryCode: recoveryCodes[0],
      });

      expect(response.statusCode).toBe(200);
    });

    it('rejects a request that sends two kinds of code at once', async () => {
      const session = await registerAndLogin();
      await enrollEmailFactor(session.accessToken);
      const mfaToken = await startLoginChallenge();

      const response = await send('POST', '/v1/auth/mfa/verify', {
        mfaToken,
        code: '123456',
        emailCode: '654321',
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('living together with the authenticator app', () => {
    async function enrollTotp(accessToken: string): Promise<string> {
      const setup = await send(
        'POST',
        '/v1/me/mfa/totp/setup',
        { password: PASSWORD },
        accessToken,
      );
      const { secret } = setup.json<{ secret: string }>();
      const code = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret) }).generate();
      await send('POST', '/v1/me/mfa/totp/confirm', { code }, accessToken);
      return secret;
    }

    it('offers the email next to the app and keeps the app as the method', async () => {
      const session = await registerAndLogin();
      await enrollTotp(session.accessToken);

      const login = await send('POST', '/v1/auth/login', { email: EMAIL, password: PASSWORD });
      const mfaToken = login.json<SessionBody>().mfaToken as string;
      await send('POST', '/v1/auth/mfa/email/send', { mfaToken });
      const verified = await send('POST', '/v1/auth/mfa/verify', {
        mfaToken,
        emailCode: emails.lastCodeSentTo(EMAIL),
      });
      const status = await send(
        'GET',
        '/v1/me/mfa',
        undefined,
        verified.json<SessionBody>().accessToken,
      );

      expect(login.json()).toMatchObject({ methods: ['totp', 'email'], emailHint: EMAIL_HINT });
      expect(verified.statusCode).toBe(200);
      expect(status.json()).toMatchObject({ isEnabled: true, method: 'totp' });
    });

    it('does not let the email setup replace an active app factor', async () => {
      const session = await registerAndLogin();
      await enrollTotp(session.accessToken);

      const response = await send(
        'POST',
        '/v1/me/mfa/email/setup',
        { password: PASSWORD },
        session.accessToken,
      );

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ code: 'MFA_ALREADY_ENABLED' });
    });
  });

  describe('management with the email method', () => {
    it('turns the second factor off with a freshly sent email code', async () => {
      const session = await registerAndLogin();
      await enrollEmailFactor(session.accessToken);

      const sent = await send('POST', '/v1/me/mfa/email/send', undefined, session.accessToken);
      const disabled = await send(
        'POST',
        '/v1/me/mfa/disable',
        { password: PASSWORD, emailCode: emails.lastCodeSentTo(EMAIL) },
        session.accessToken,
      );

      expect(sent.statusCode).toBe(200);
      expect(disabled.statusCode).toBe(204);
      const login = await send('POST', '/v1/auth/login', { email: EMAIL, password: PASSWORD });
      expect(login.json()).toMatchObject({ status: 'authenticated' });
    });

    it('regenerates the recovery codes with an email code', async () => {
      const session = await registerAndLogin();
      await enrollEmailFactor(session.accessToken);
      await send('POST', '/v1/me/mfa/email/send', undefined, session.accessToken);

      const response = await send(
        'POST',
        '/v1/me/mfa/recovery-codes/regenerate',
        { password: PASSWORD, emailCode: emails.lastCodeSentTo(EMAIL) },
        session.accessToken,
      );

      expect(response.statusCode).toBe(200);
      expect(response.json<{ recoveryCodes: string[] }>().recoveryCodes).toHaveLength(10);
    });

    it('refuses to send a code when there is no second factor', async () => {
      const session = await registerAndLogin();

      const response = await send('POST', '/v1/me/mfa/email/send', undefined, session.accessToken);

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ code: 'MFA_NOT_ENABLED' });
    });
  });
});
