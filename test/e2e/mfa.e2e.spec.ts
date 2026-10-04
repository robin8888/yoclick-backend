import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import * as OTPAuth from 'otpauth';
import { BREACHED_PASSWORD_CHECKER } from '../../src/modules/auth/application/ports/breached-password.checker';
import { MAX_FAILED_LOGIN_ATTEMPTS } from '../../src/modules/auth/domain/login-policy';
import { PrismaService } from '../../src/shared/database/prisma.service';
import { TenantPrismaService } from '../../src/shared/database/tenant-prisma.service';
import { EMAIL_SENDER } from '../../src/shared/email/email-sender';
import { MILLISECONDS_PER_SECOND } from '../../src/shared/time/time-units';
import { DatabaseFixtures } from '../support/database-fixtures';
import { FakeBreachedPasswordChecker, RecordingEmailSender } from '../support/auth-fakes';
import { GuardProbeModule } from '../support/guard-probe.module';
import { resetTestDatabase } from '../support/test-database';
import { createTestApplication } from './create-test-application';

const EMAIL = 'robin@yopmail.com';
const PASSWORD = 'Nosnibor88';
const TOTP_PERIOD_SECONDS = 30;
const WRONG_CODE = '000000';

interface SessionBody {
  status: string;
  accessToken: string;
  refreshToken: string;
  mfaToken?: string;
}

describe('second factor (TOTP) for sign-in and administrative roles', () => {
  let application: NestFastifyApplication;
  let prismaService: PrismaService;
  let tenantPrismaService: TenantPrismaService;
  let fixtures: DatabaseFixtures;
  const emails = new RecordingEmailSender();

  async function send(
    method: 'GET' | 'POST',
    url: string,
    payload?: unknown,
    accessToken?: string,
    extraHeaders: Record<string, string> = {},
  ) {
    return application.inject({
      method,
      url,
      ...(payload === undefined ? {} : { payload: payload as object }),
      headers: { ...(accessToken && { authorization: `Bearer ${accessToken}` }), ...extraHeaders },
    });
  }

  /** Código que la app de autenticación mostraría `stepsAhead` intervalos más tarde. */
  function totpCode(base32Secret: string, stepsAhead = 0): string {
    return new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(base32Secret) }).generate({
      timestamp: Date.now() + stepsAhead * TOTP_PERIOD_SECONDS * MILLISECONDS_PER_SECOND,
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

  /** Activa el segundo factor con el flujo real y devuelve el secreto y los códigos de recuperación. */
  async function enrollSecondFactor(accessToken: string) {
    const setup = await send('POST', '/v1/me/mfa/totp/setup', { password: PASSWORD }, accessToken);
    const { secret } = setup.json<{ secret: string }>();
    const confirmation = await send(
      'POST',
      '/v1/me/mfa/totp/confirm',
      { code: totpCode(secret) },
      accessToken,
    );
    return {
      secret,
      recoveryCodes: confirmation.json<{ recoveryCodes: string[] }>().recoveryCodes,
    };
  }

  async function loginWithChallenge(): Promise<string> {
    const response = await send('POST', '/v1/auth/login', { email: EMAIL, password: PASSWORD });
    const body = response.json<SessionBody>();
    expect(body.status).toBe('mfa_required');
    return body.mfaToken as string;
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
    fixtures = new DatabaseFixtures(prismaService, tenantPrismaService);
  });

  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterAll(async () => {
    await application.close();
  });

  describe('enrolment', () => {
    it('starts with no second factor', async () => {
      const session = await registerAndLogin();

      const response = await send('GET', '/v1/me/mfa', undefined, session.accessToken);

      expect(response.json()).toEqual({ isEnabled: false, recoveryCodesRemaining: 0 });
    });

    it('asks for the password before showing a secret', async () => {
      const session = await registerAndLogin();

      const response = await send(
        'POST',
        '/v1/me/mfa/totp/setup',
        { password: 'Incorrecta123' },
        session.accessToken,
      );

      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ code: 'REAUTHENTICATION_FAILED' });
    });

    it('enables the second factor with the first valid code and hands out ten recovery codes once', async () => {
      const session = await registerAndLogin();

      const { recoveryCodes } = await enrollSecondFactor(session.accessToken);

      expect(recoveryCodes).toHaveLength(10);
      const status = await send('GET', '/v1/me/mfa', undefined, session.accessToken);
      expect(status.json()).toEqual({ isEnabled: true, recoveryCodesRemaining: 10 });
    });

    it('does not enable it with a wrong code', async () => {
      const session = await registerAndLogin();
      await send('POST', '/v1/me/mfa/totp/setup', { password: PASSWORD }, session.accessToken);

      const response = await send(
        'POST',
        '/v1/me/mfa/totp/confirm',
        { code: WRONG_CODE },
        session.accessToken,
      );

      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ code: 'MFA_CODE_INVALID' });
    });

    it('refuses to start enrolment again once it is active', async () => {
      const session = await registerAndLogin();
      await enrollSecondFactor(session.accessToken);

      const response = await send(
        'POST',
        '/v1/me/mfa/totp/setup',
        { password: PASSWORD },
        session.accessToken,
      );

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ code: 'MFA_ALREADY_ENABLED' });
    });

    it('stores the secret encrypted, never in clear', async () => {
      const session = await registerAndLogin();
      const { id: userId } = (await send('GET', '/v1/me', undefined, session.accessToken)).json<{
        id: string;
      }>();

      const { secret } = await enrollSecondFactor(session.accessToken);

      const stored = await tenantPrismaService.runInUserContext(userId, (client) =>
        client.mfaFactor.findUniqueOrThrow({ where: { userId } }),
      );
      expect(stored.secretEncrypted).not.toContain(secret);
      expect(stored.secretEncrypted.startsWith('v1.')).toBe(true);
    });
  });

  describe('signing in with a second factor', () => {
    it('answers the password step with a challenge instead of a session', async () => {
      const session = await registerAndLogin();
      await enrollSecondFactor(session.accessToken);

      const response = await send('POST', '/v1/auth/login', { email: EMAIL, password: PASSWORD });

      const body = response.json<Record<string, unknown>>();
      expect(body['status']).toBe('mfa_required');
      expect(body['accessToken']).toBeUndefined();
      expect(body['refreshToken']).toBeUndefined();
    });

    it('opens the session with a valid code', async () => {
      const first = await registerAndLogin();
      const { secret } = await enrollSecondFactor(first.accessToken);
      const mfaToken = await loginWithChallenge();

      const response = await send('POST', '/v1/auth/mfa/verify', {
        mfaToken,
        code: totpCode(secret, 1),
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ status: 'authenticated' });
    });

    it('rejects a code that was already used, even inside its 30 seconds', async () => {
      const first = await registerAndLogin();
      const { secret } = await enrollSecondFactor(first.accessToken);
      const code = totpCode(secret, 1);
      await send('POST', '/v1/auth/mfa/verify', { mfaToken: await loginWithChallenge(), code });

      const replay = await send('POST', '/v1/auth/mfa/verify', {
        mfaToken: await loginWithChallenge(),
        code,
      });

      expect(replay.statusCode).toBe(401);
      expect(replay.json()).toMatchObject({ code: 'MFA_CODE_INVALID' });
    });

    it('accepts a recovery code once and only once', async () => {
      const first = await registerAndLogin();
      const { recoveryCodes } = await enrollSecondFactor(first.accessToken);
      const [recoveryCode] = recoveryCodes;

      const used = await send('POST', '/v1/auth/mfa/verify', {
        mfaToken: await loginWithChallenge(),
        recoveryCode,
      });
      const reused = await send('POST', '/v1/auth/mfa/verify', {
        mfaToken: await loginWithChallenge(),
        recoveryCode,
      });

      expect(used.statusCode).toBe(200);
      expect(reused.statusCode).toBe(401);
    });

    it('does not accept a password-only access token as proof of the second factor', async () => {
      const first = await registerAndLogin();
      await enrollSecondFactor(first.accessToken);

      const response = await send('POST', '/v1/auth/mfa/verify', {
        mfaToken: first.accessToken,
        code: WRONG_CODE,
      });

      expect(response.statusCode).toBe(401);
    });

    it('locks the account after repeated wrong codes, sharing the counter with the password', async () => {
      const first = await registerAndLogin();
      await enrollSecondFactor(first.accessToken);
      const mfaToken = await loginWithChallenge();

      for (let attempt = 0; attempt < MAX_FAILED_LOGIN_ATTEMPTS; attempt += 1) {
        await send('POST', '/v1/auth/mfa/verify', { mfaToken, code: WRONG_CODE });
      }

      const afterLock = await send('POST', '/v1/auth/login', { email: EMAIL, password: PASSWORD });
      expect(afterLock.statusCode).toBe(401);
    });

    it('keeps the second-factor level when the session is refreshed', async () => {
      const first = await registerAndLogin();
      const { secret } = await enrollSecondFactor(first.accessToken);
      const verified = (
        await send('POST', '/v1/auth/mfa/verify', {
          mfaToken: await loginWithChallenge(),
          code: totpCode(secret, 1),
        })
      ).json<SessionBody>();

      const refreshed = (
        await send('POST', '/v1/auth/refresh', { refreshToken: verified.refreshToken })
      ).json<SessionBody>();

      const payload = JSON.parse(
        Buffer.from(refreshed.accessToken.split('.')[1] as string, 'base64url').toString(),
      ) as { amr?: string[] };
      expect(payload.amr).toContain('otp');
    });
  });

  describe('administrative roles', () => {
    it('blocks an owner whose session has no second factor, and lets them in with it', async () => {
      const session = await registerAndLogin();
      const userId = (await send('GET', '/v1/me', undefined, session.accessToken)).json<{
        id: string;
      }>().id;
      const centerId = await fixtures.createCenter('center-mfa', 'MFAAAA');
      await fixtures.createMembership({ centerId, userId, role: 'owner' });
      const adminHeaders = { 'x-center-id': centerId };

      const withoutSecondFactor = await send(
        'GET',
        '/v1/probe-guards/admin-area',
        undefined,
        session.accessToken,
        adminHeaders,
      );
      const { secret } = await enrollSecondFactor(session.accessToken);
      const verified = (
        await send('POST', '/v1/auth/mfa/verify', {
          mfaToken: await loginWithChallenge(),
          code: totpCode(secret, 1),
        })
      ).json<SessionBody>();
      const withSecondFactor = await send(
        'GET',
        '/v1/probe-guards/admin-area',
        undefined,
        verified.accessToken,
        adminHeaders,
      );

      expect(withoutSecondFactor.statusCode).toBe(403);
      expect(withoutSecondFactor.json()).toMatchObject({ code: 'MFA_REQUIRED' });
      expect(withSecondFactor.statusCode).toBe(200);
    });

    it('does not let an owner turn the second factor off', async () => {
      const session = await registerAndLogin();
      const userId = (await send('GET', '/v1/me', undefined, session.accessToken)).json<{
        id: string;
      }>().id;
      const centerId = await fixtures.createCenter('center-off', 'OFFAAA');
      await fixtures.createMembership({ centerId, userId, role: 'owner' });
      const { secret } = await enrollSecondFactor(session.accessToken);

      const response = await send(
        'POST',
        '/v1/me/mfa/disable',
        { password: PASSWORD, code: totpCode(secret, 1) },
        session.accessToken,
      );

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ code: 'MFA_REQUIRED_FOR_ROLE' });
    });
  });

  describe('management', () => {
    it('regenerates the recovery codes and invalidates the old ones', async () => {
      const session = await registerAndLogin();
      const { secret, recoveryCodes } = await enrollSecondFactor(session.accessToken);

      const regenerated = await send(
        'POST',
        '/v1/me/mfa/recovery-codes/regenerate',
        { password: PASSWORD, code: totpCode(secret, 1) },
        session.accessToken,
      );
      const oldCodeAttempt = await send('POST', '/v1/auth/mfa/verify', {
        mfaToken: await loginWithChallenge(),
        recoveryCode: recoveryCodes[0],
      });

      expect(regenerated.json<{ recoveryCodes: string[] }>().recoveryCodes).toHaveLength(10);
      expect(oldCodeAttempt.statusCode).toBe(401);
    });

    it('lets a regular person turn it off with password and code', async () => {
      const session = await registerAndLogin();
      const { secret } = await enrollSecondFactor(session.accessToken);

      const response = await send(
        'POST',
        '/v1/me/mfa/disable',
        { password: PASSWORD, code: totpCode(secret, 1) },
        session.accessToken,
      );

      expect(response.statusCode).toBe(204);
      const login = await send('POST', '/v1/auth/login', { email: EMAIL, password: PASSWORD });
      expect(login.json()).toMatchObject({ status: 'authenticated' });
    });
  });
});
