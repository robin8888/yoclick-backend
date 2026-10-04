import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { BREACHED_PASSWORD_CHECKER } from '../../src/modules/auth/application/ports/breached-password.checker';
import { EMAIL_SENDER } from '../../src/shared/email/email-sender';
import { DEFAULT_RATE_LIMIT, RATE_LIMITS } from '../../src/shared/rate-limit/rate-limit-policies';
import { RATE_LIMIT_SETTINGS } from '../../src/shared/rate-limit/rate-limit.module';
import { FakeBreachedPasswordChecker, RecordingEmailSender } from '../support/auth-fakes';
import { GuardProbeModule } from '../support/guard-probe.module';
import { resetTestDatabase } from '../support/test-database';
import { createTestApplication } from './create-test-application';

const PROBLEM_CONTENT_TYPE = 'application/problem+json';

describe('rate limiting per IP', () => {
  let application: NestFastifyApplication;
  const emails = new RecordingEmailSender();

  async function post(url: string, payload: unknown, headers: Record<string, string> = {}) {
    return application.inject({ method: 'POST', url, payload: payload as object, headers });
  }

  async function loginAttempt(headers: Record<string, string> = {}) {
    return post(
      '/v1/auth/login',
      { email: 'nobody@yopmail.com', password: 'wrong password!!' },
      headers,
    );
  }

  beforeEach(async () => {
    await resetTestDatabase();
    emails.sent.length = 0;
    // Cada test arranca una aplicación nueva: el contador de peticiones empieza en cero.
    application = await createTestApplication({
      extraModules: [GuardProbeModule],
      overrides: [
        { token: RATE_LIMIT_SETTINGS, value: { isEnabled: true } },
        { token: EMAIL_SENDER, value: emails },
        { token: BREACHED_PASSWORD_CHECKER, value: new FakeBreachedPasswordChecker() },
      ],
    });
  });

  afterEach(async () => {
    await application.close();
  });

  it(`lets ${String(RATE_LIMITS.login.limit)} login attempts through per minute, and answers 429 from the next one`, async () => {
    for (let attempt = 0; attempt < RATE_LIMITS.login.limit; attempt += 1) {
      expect((await loginAttempt()).statusCode).toBe(401);
    }

    const blocked = await loginAttempt();

    expect(blocked.statusCode).toBe(429);
  });

  it('limits join-code guessing per IP, so codes cannot be enumerated', async () => {
    const guess = async () => application.inject({ method: 'GET', url: '/v1/join/code/ZZZZZZ' });
    for (let attempt = 0; attempt < RATE_LIMITS.submitCode.limit; attempt += 1) {
      expect((await guess()).statusCode).toBe(404);
    }

    expect((await guess()).statusCode).toBe(429);
  });

  it('answers 429 as problem+json with a stable code and a Retry-After header', async () => {
    for (let attempt = 0; attempt < RATE_LIMITS.login.limit; attempt += 1) await loginAttempt();

    const blocked = await loginAttempt();

    expect(blocked.headers['content-type']).toContain(PROBLEM_CONTENT_TYPE);
    expect(blocked.json()).toMatchObject({ status: 429, code: 'RATE_LIMITED' });
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('stops the request before any password hashing: a blocked attempt is fast', async () => {
    for (let attempt = 0; attempt < RATE_LIMITS.login.limit; attempt += 1) await loginAttempt();

    const startedAt = performance.now();
    await loginAttempt();
    const elapsedMilliseconds = performance.now() - startedAt;

    // Un intento que llega al hash de argon2 tarda decenas de milisegundos; el bloqueado, casi nada.
    expect(elapsedMilliseconds).toBeLessThan(25);
  });

  it('cannot be bypassed by forging X-Forwarded-For: the real address counts', async () => {
    for (let attempt = 0; attempt < RATE_LIMITS.login.limit; attempt += 1) {
      await loginAttempt({ 'x-forwarded-for': `203.0.113.${String(attempt)}` });
    }

    const blocked = await loginAttempt({ 'x-forwarded-for': '198.51.100.99' });

    expect(blocked.statusCode).toBe(429);
  });

  it('counts each route on its own: exhausting login does not block registration', async () => {
    for (let attempt = 0; attempt < RATE_LIMITS.login.limit + 1; attempt += 1) await loginAttempt();

    const registration = await post('/v1/auth/register', {
      email: 'robin@yopmail.com',
      password: 'correct horse battery staple',
      fullName: 'Robin R',
      consents: { privacy: true, terms: true },
    });

    expect(registration.statusCode).toBe(202);
  });

  it.each([
    ['register', '/v1/auth/register', RATE_LIMITS.register.limit],
    ['forgot password', '/v1/auth/password/forgot', RATE_LIMITS.forgotPassword.limit],
    ['resend verification', '/v1/auth/email/resend', RATE_LIMITS.resendVerification.limit],
    ['verify email code', '/v1/auth/email/verify', RATE_LIMITS.submitCode.limit],
    ['reset password code', '/v1/auth/password/reset', RATE_LIMITS.submitCode.limit],
  ])('limits %s', async (_name, url, limit) => {
    const payload = {
      email: 'robin@yopmail.com',
      code: '123456',
      password: 'correct horse battery staple',
      newPassword: 'correct horse battery staple',
      fullName: 'Robin R',
      consents: { privacy: true, terms: true },
    };
    const accepted: number[] = [];
    for (let attempt = 0; attempt < limit; attempt += 1) {
      accepted.push((await post(url, payload)).statusCode);
    }

    const blocked = await post(url, payload);

    expect(accepted).not.toContain(429);
    expect(blocked.statusCode).toBe(429);
  });

  it('applies a global ceiling to every other route', async () => {
    for (let request = 0; request < DEFAULT_RATE_LIMIT.limit; request += 1) {
      await application.inject({ method: 'GET', url: '/v1/probe-guards/public' });
    }

    const blocked = await application.inject({ method: 'GET', url: '/v1/probe-guards/public' });

    expect(blocked.statusCode).toBe(429);
  });

  it('never throttles the health check, which monitors poll constantly', async () => {
    for (let request = 0; request < DEFAULT_RATE_LIMIT.limit + 20; request += 1) {
      const response = await application.inject({ method: 'GET', url: '/health' });
      expect(response.statusCode).toBe(200);
    }
  });
});
