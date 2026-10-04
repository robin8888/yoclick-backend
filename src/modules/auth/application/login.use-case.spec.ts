import {
  InMemorySessionRepository,
  InMemoryUserAccountRepository,
  RecordingEmailSender,
} from '../../../../test/support/auth-fakes';
import { type AccessTokenService } from '../../../shared/auth/access-token.service';
import { type PasswordHasher } from '../../../shared/auth/password-hasher';
import { MAX_FAILED_LOGIN_ATTEMPTS } from '../domain/login-policy';
import { AccountSecurityNotifier } from './account-security-notifier';
import { LoginUseCase } from './login.use-case';
import { SessionIssuer } from './session-issuer';

const EMAIL = 'ana@gmail.com';
const PASSWORD = 'correct horse battery staple';
const USER_ID = 'user-1';

function buildScenario(options: { needsRehash?: boolean } = {}) {
  const users = new InMemoryUserAccountRepository();
  users.seedAccount({
    id: USER_ID,
    email: EMAIL,
    fullName: 'Ana Pérez',
    passwordHash: `hashed:${PASSWORD}`,
    emailVerifiedAt: new Date(),
  });
  const sessions = new InMemorySessionRepository();
  const emails = new RecordingEmailSender();
  const spendTime = jest.fn().mockResolvedValue(undefined);
  const hasher = {
    hash: (plain: string) => Promise.resolve(`rehashed:${plain}`),
    verify: (storedHash: string, plain: string) =>
      Promise.resolve(storedHash.endsWith(`:${plain}`)),
    needsRehash: () => options.needsRehash ?? false,
    spendTimeLikeAVerification: spendTime,
  } as unknown as PasswordHasher;
  const accessTokens = {
    issue: (userId: string) =>
      Promise.resolve({ token: `access-for-${userId}`, expiresAt: new Date(Date.now() + 600_000) }),
  } as unknown as AccessTokenService;
  const login = new LoginUseCase(
    users,
    hasher,
    new SessionIssuer(sessions, accessTokens),
    new AccountSecurityNotifier(emails),
  );
  return { users, sessions, emails, login, spendTime };
}

async function captureError(action: Promise<unknown>): Promise<unknown> {
  try {
    await action;
  } catch (error) {
    return error;
  }
  return undefined;
}

const INVALID_CREDENTIALS = { code: 'INVALID_CREDENTIALS', httpStatus: 401 };

describe('LoginUseCase', () => {
  it('opens a session with an access token, a refresh token and the person data', async () => {
    const { login } = buildScenario();

    const session = await login.execute({ email: EMAIL, password: PASSWORD, deviceName: 'iPhone' });

    expect(session.accessToken).toBe(`access-for-${USER_ID}`);
    expect(session.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(session.user).toEqual({ id: USER_ID, email: EMAIL, fullName: 'Ana Pérez' });
    expect(session.refreshTokenExpiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('stores only the hash of the refresh token', async () => {
    const { login, sessions } = buildScenario();

    const session = await login.execute({ email: EMAIL, password: PASSWORD, deviceName: null });

    expect(sessions.tokens).toHaveLength(1);
    expect(sessions.tokens[0]?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(sessions.tokens)).not.toContain(session.refreshToken);
  });

  it('gives every login its own token family, so devices are revoked independently', async () => {
    const { login, sessions } = buildScenario();

    await login.execute({ email: EMAIL, password: PASSWORD, deviceName: 'iPhone' });
    await login.execute({ email: EMAIL, password: PASSWORD, deviceName: 'Android' });

    const families = new Set(sessions.tokens.map((token) => token.familyId));
    expect(families.size).toBe(2);
  });

  describe('bad credentials never say which part was wrong (SEC-46)', () => {
    it('rejects an unknown email', async () => {
      const { login } = buildScenario();

      const error = await captureError(
        login.execute({ email: 'nobody@gmail.com', password: PASSWORD, deviceName: null }),
      );

      expect(error).toMatchObject(INVALID_CREDENTIALS);
    });

    it('rejects a wrong password with the very same error', async () => {
      const { login } = buildScenario();

      const error = await captureError(
        login.execute({ email: EMAIL, password: 'wrong password!!', deviceName: null }),
      );

      expect(error).toMatchObject(INVALID_CREDENTIALS);
    });

    it('spends the cost of a verification on an unknown email, so timing reveals nothing', async () => {
      const { login, spendTime } = buildScenario();

      await captureError(
        login.execute({ email: 'nobody@gmail.com', password: PASSWORD, deviceName: null }),
      );

      expect(spendTime).toHaveBeenCalledTimes(1);
    });

    it('creates no session on failure', async () => {
      const { login, sessions } = buildScenario();

      await captureError(
        login.execute({ email: EMAIL, password: 'wrong password!!', deviceName: null }),
      );

      expect(sessions.tokens).toHaveLength(0);
    });
  });

  describe('lockout after repeated failures', () => {
    async function failRepeatedly(scenario: ReturnType<typeof buildScenario>, times: number) {
      for (let attempt = 0; attempt < times; attempt += 1) {
        await captureError(
          scenario.login.execute({ email: EMAIL, password: 'wrong password!!', deviceName: null }),
        );
      }
    }

    it(`locks the account at ${String(MAX_FAILED_LOGIN_ATTEMPTS)} failures, even for the right password`, async () => {
      const scenario = buildScenario();
      await failRepeatedly(scenario, MAX_FAILED_LOGIN_ATTEMPTS);

      const error = await captureError(
        scenario.login.execute({ email: EMAIL, password: PASSWORD, deviceName: null }),
      );

      expect(error).toMatchObject(INVALID_CREDENTIALS);
    });

    it('does not reveal the lock: a locked account answers like any bad credentials', async () => {
      const scenario = buildScenario();
      await failRepeatedly(scenario, MAX_FAILED_LOGIN_ATTEMPTS);

      const error = await captureError(
        scenario.login.execute({ email: EMAIL, password: PASSWORD, deviceName: null }),
      );

      expect(error).toMatchObject({ code: 'INVALID_CREDENTIALS' });
      expect(JSON.stringify(error)).not.toMatch(/lock|bloque/i);
    });

    it('warns the owner by email, once, at the moment the lock starts', async () => {
      const scenario = buildScenario();

      await failRepeatedly(scenario, MAX_FAILED_LOGIN_ATTEMPTS + 3);

      expect(scenario.emails.messagesTo(EMAIL)).toHaveLength(1);
      expect(scenario.emails.messagesTo(EMAIL)[0]?.subject).toMatch(/bloque/i);
    });

    it('lets the person in again once the lock has expired', async () => {
      const scenario = buildScenario();
      await failRepeatedly(scenario, MAX_FAILED_LOGIN_ATTEMPTS);
      const account = scenario.users.accounts.get(EMAIL);
      scenario.users.accounts.set(EMAIL, {
        ...account!,
        lockedUntil: new Date(Date.now() - 1_000),
      });

      const session = await scenario.login.execute({
        email: EMAIL,
        password: PASSWORD,
        deviceName: null,
      });

      expect(session.user.id).toBe(USER_ID);
    });

    it('resets the failure counter after a successful login', async () => {
      const scenario = buildScenario();
      await failRepeatedly(scenario, MAX_FAILED_LOGIN_ATTEMPTS - 1);
      await scenario.login.execute({ email: EMAIL, password: PASSWORD, deviceName: null });

      await failRepeatedly(scenario, MAX_FAILED_LOGIN_ATTEMPTS - 1);

      const session = await scenario.login.execute({
        email: EMAIL,
        password: PASSWORD,
        deviceName: null,
      });
      expect(session.user.id).toBe(USER_ID);
    });
  });

  describe('email verification', () => {
    it('refuses a verified-password login while the email is unconfirmed (403 EMAIL_NOT_VERIFIED)', async () => {
      const { login, users } = buildScenario();
      const account = users.accounts.get(EMAIL);
      users.accounts.set(EMAIL, { ...account!, emailVerifiedAt: null });

      const error = await captureError(
        login.execute({ email: EMAIL, password: PASSWORD, deviceName: null }),
      );

      expect(error).toMatchObject({ code: 'EMAIL_NOT_VERIFIED', httpStatus: 403 });
    });

    it('does not reveal that the account exists to someone who does not know its password', async () => {
      const { login, users } = buildScenario();
      const account = users.accounts.get(EMAIL);
      users.accounts.set(EMAIL, { ...account!, emailVerifiedAt: null });

      const error = await captureError(
        login.execute({ email: EMAIL, password: 'wrong password!!', deviceName: null }),
      );

      expect(error).toMatchObject(INVALID_CREDENTIALS);
    });
  });

  it('upgrades the password hash at login when its parameters are outdated', async () => {
    const { login, users } = buildScenario({ needsRehash: true });

    await login.execute({ email: EMAIL, password: PASSWORD, deviceName: null });

    expect(users.accounts.get(EMAIL)?.passwordHash).toBe(`rehashed:${PASSWORD}`);
  });
});
