import {
  InMemoryUserAccountRepository,
  RecordingEmailSender,
} from '../../../../test/support/auth-fakes';
import { type PasswordHasher } from '../../../shared/auth/password-hasher';
import { MAX_FAILED_LOGIN_ATTEMPTS } from '../domain/login-policy';
import { AccountSecurityNotifier } from './account-security-notifier';
import { LoginFailureRecorder } from './login-failure-recorder';
import { ReauthenticationChecker } from './reauthentication.checker';

const USER_ID = 'user-1';
const PASSWORD = 'correct horse battery staple';

function buildScenario() {
  const users = new InMemoryUserAccountRepository();
  users.seedAccount({
    id: USER_ID,
    email: 'ana@gmail.com',
    fullName: 'Ana Pérez',
    passwordHash: `hashed:${PASSWORD}`,
    emailVerifiedAt: new Date(),
  });
  const emails = new RecordingEmailSender();
  const spendTime = jest.fn().mockResolvedValue(undefined);
  const hasher = {
    verify: (storedHash: string, plain: string) =>
      Promise.resolve(storedHash === `hashed:${plain}`),
    spendTimeLikeAVerification: spendTime,
  } as unknown as PasswordHasher;
  const checker = new ReauthenticationChecker(
    users,
    hasher,
    new LoginFailureRecorder(users, new AccountSecurityNotifier(emails)),
  );
  return { users, emails, checker, spendTime };
}

async function captureError(action: Promise<unknown>): Promise<unknown> {
  try {
    await action;
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('ReauthenticationChecker', () => {
  it('returns the account when the password is right', async () => {
    const { checker } = buildScenario();

    const account = await checker.assertPasswordIsCorrect(USER_ID, PASSWORD);

    expect(account.id).toBe(USER_ID);
  });

  it('answers 403 REAUTHENTICATION_FAILED for a wrong password, not 401 (a 401 would make the app try to refresh)', async () => {
    const { checker } = buildScenario();

    const error = await captureError(checker.assertPasswordIsCorrect(USER_ID, 'not the password'));

    expect(error).toMatchObject({ code: 'REAUTHENTICATION_FAILED', httpStatus: 403 });
  });

  it('counts wrong passwords towards the lockout, so this endpoint is no way around the login limit', async () => {
    const { checker, users } = buildScenario();

    for (let attempt = 0; attempt < MAX_FAILED_LOGIN_ATTEMPTS; attempt += 1) {
      await captureError(checker.assertPasswordIsCorrect(USER_ID, 'not the password'));
    }

    expect(users.accounts.get('ana@gmail.com')?.lockedUntil).toBeInstanceOf(Date);
  });

  it('refuses even the right password while the account is locked, spending the usual time', async () => {
    const { checker, users, spendTime } = buildScenario();
    for (let attempt = 0; attempt < MAX_FAILED_LOGIN_ATTEMPTS; attempt += 1) {
      await captureError(checker.assertPasswordIsCorrect(USER_ID, 'not the password'));
    }
    expect(users.accounts.size).toBe(1);

    const error = await captureError(checker.assertPasswordIsCorrect(USER_ID, PASSWORD));

    expect(error).toMatchObject({ code: 'REAUTHENTICATION_FAILED' });
    expect(spendTime).toHaveBeenCalled();
  });

  it('warns the owner by email once when the repeated failures lock the account', async () => {
    const { checker, emails } = buildScenario();

    for (let attempt = 0; attempt < MAX_FAILED_LOGIN_ATTEMPTS + 2; attempt += 1) {
      await captureError(checker.assertPasswordIsCorrect(USER_ID, 'not the password'));
    }

    expect(emails.messagesTo('ana@gmail.com')).toHaveLength(1);
  });

  it('clears the failure counter after a correct password', async () => {
    const { checker, users } = buildScenario();
    await captureError(checker.assertPasswordIsCorrect(USER_ID, 'not the password'));

    await checker.assertPasswordIsCorrect(USER_ID, PASSWORD);

    expect(users.accounts.get('ana@gmail.com')?.failedLoginCount).toBe(0);
  });

  it('answers 401 UNAUTHENTICATED when the account no longer exists, such as a deleted one', async () => {
    const { checker } = buildScenario();

    const error = await captureError(checker.assertPasswordIsCorrect('ghost-user', PASSWORD));

    expect(error).toMatchObject({ code: 'UNAUTHENTICATED', httpStatus: 401 });
  });
});
