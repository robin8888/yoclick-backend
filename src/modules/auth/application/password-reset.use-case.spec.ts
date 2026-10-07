import {
  FakeBreachedPasswordChecker,
  FakeVerificationCodeHasher,
  InMemorySessionRepository,
  InMemoryUserAccountRepository,
  InMemoryVerificationCodeRepository,
  RecordingEmailSender,
} from '../../../../test/support/auth-fakes';
import { type PasswordHasher } from '../../../shared/auth/password-hasher';
import { MAX_VERIFICATION_ATTEMPTS } from '../domain/verification-code';
import { AccountPasswordChanger } from './account-password-changer';
import { AccountSecurityNotifier } from './account-security-notifier';
import { ForgotPasswordUseCase } from './forgot-password.use-case';
import { PasswordAcceptabilityChecker } from './password-acceptability.checker';
import { ResetPasswordUseCase } from './reset-password.use-case';
import { VerificationCodeChecker } from './verification-code-checker';
import { VerificationCodeIssuer } from './verification-code-issuer';

const EMAIL = 'ana@gmail.com';
const USER_ID = 'user-1';
const OLD_PASSWORD = 'old correct horse battery';
const NEW_PASSWORD = 'brand new passphrase 2026';
const BREACHED_PASSWORD = 'password123456';

function buildScenario(options: { isVerified?: boolean; isUnactivated?: boolean } = {}) {
  const users = new InMemoryUserAccountRepository();
  users.seedAccount({
    id: USER_ID,
    email: EMAIL,
    fullName: 'Ana Pérez',
    passwordHash: options.isUnactivated === true ? '!' : `hashed:${OLD_PASSWORD}`,
    emailVerifiedAt:
      options.isVerified === false || options.isUnactivated === true ? null : new Date(),
    failedLoginCount: 4,
  });
  const codes = new InMemoryVerificationCodeRepository();
  const sessions = new InMemorySessionRepository();
  const emails = new RecordingEmailSender();
  const hasher = new FakeVerificationCodeHasher();
  const passwordHasher = {
    hash: (plain: string) => Promise.resolve(`hashed:${plain}`),
  } as unknown as PasswordHasher;
  const issuer = new VerificationCodeIssuer(codes, hasher, emails);
  const changer = new AccountPasswordChanger(
    users,
    sessions,
    passwordHasher,
    new AccountSecurityNotifier(emails),
  );
  return {
    users,
    codes,
    sessions,
    emails,
    issuer,
    forgotPassword: new ForgotPasswordUseCase(users, issuer),
    resetPassword: new ResetPasswordUseCase(
      users,
      new VerificationCodeChecker(codes, hasher),
      new PasswordAcceptabilityChecker(new FakeBreachedPasswordChecker([BREACHED_PASSWORD])),
      changer,
    ),
  };
}

async function requestResetCode(scenario: ReturnType<typeof buildScenario>): Promise<string> {
  await scenario.forgotPassword.execute({ email: EMAIL });
  return scenario.emails.lastCodeSentTo(EMAIL) ?? '';
}

async function captureError(action: Promise<unknown>): Promise<unknown> {
  try {
    await action;
  } catch (error) {
    return error;
  }
  return undefined;
}

const INVALID_CODE = { code: 'VERIFICATION_CODE_INVALID', httpStatus: 400 };

describe('ForgotPasswordUseCase', () => {
  it('emails a 6-digit reset code to a verified account', async () => {
    const scenario = buildScenario();

    await scenario.forgotPassword.execute({ email: EMAIL });

    expect(scenario.emails.lastCodeSentTo(EMAIL)).toMatch(/^\d{6}$/);
    expect(scenario.emails.messagesTo(EMAIL)[0]?.subject).toMatch(/contraseña/i);
  });

  it('does nothing, without error, for an unknown email (no enumeration)', async () => {
    const scenario = buildScenario();

    await expect(
      scenario.forgotPassword.execute({ email: 'nobody@gmail.com' }),
    ).resolves.toBeUndefined();
    expect(scenario.emails.sent).toHaveLength(0);
  });

  it('does nothing for an account whose email was never confirmed: that comes first', async () => {
    const scenario = buildScenario({ isVerified: false });

    await scenario.forgotPassword.execute({ email: EMAIL });

    expect(scenario.emails.sent).toHaveLength(0);
  });

  it('emails the code to an account a center created by importing, which has no password yet', async () => {
    const scenario = buildScenario({ isUnactivated: true });

    await scenario.forgotPassword.execute({ email: EMAIL });

    expect(scenario.emails.lastCodeSentTo(EMAIL)).toMatch(/^\d{6}$/);
  });

  it('lets the owner of an imported account set a password with that code, and confirms the email', async () => {
    const scenario = buildScenario({ isUnactivated: true });
    const code = await requestResetCode(scenario);

    await scenario.resetPassword.execute({ email: EMAIL, code, newPassword: NEW_PASSWORD });

    const account = scenario.users.accounts.get(EMAIL);
    expect(account?.passwordHash).toBe(`hashed:${NEW_PASSWORD}`);
    expect(account?.emailVerifiedAt).toBeInstanceOf(Date);
  });

  it('does not send a second code while the first is recent', async () => {
    const scenario = buildScenario();
    await scenario.forgotPassword.execute({ email: EMAIL });
    scenario.emails.sent.length = 0;

    await scenario.forgotPassword.execute({ email: EMAIL });

    expect(scenario.emails.sent).toHaveLength(0);
  });
});

describe('ResetPasswordUseCase', () => {
  it('changes the password with the emailed code', async () => {
    const scenario = buildScenario();
    const code = await requestResetCode(scenario);

    await scenario.resetPassword.execute({ email: EMAIL, code, newPassword: NEW_PASSWORD });

    expect(scenario.users.accounts.get(EMAIL)?.passwordHash).toBe(`hashed:${NEW_PASSWORD}`);
  });

  it('signs the person out of every device: whoever had the old password loses access', async () => {
    const scenario = buildScenario();
    await scenario.sessions.create({
      id: 'token-1',
      userId: USER_ID,
      familyId: 'family-1',
      tokenHash: 'hash-1',
      deviceName: null,
      isMfaVerified: false,
      expiresAt: new Date(Date.now() + 1_000_000),
    });
    const code = await requestResetCode(scenario);

    await scenario.resetPassword.execute({ email: EMAIL, code, newPassword: NEW_PASSWORD });

    expect(scenario.sessions.activeTokensOf(USER_ID)).toBe(0);
  });

  it('clears the failed-login counter and any lock', async () => {
    const scenario = buildScenario();
    const code = await requestResetCode(scenario);

    await scenario.resetPassword.execute({ email: EMAIL, code, newPassword: NEW_PASSWORD });

    expect(scenario.users.accounts.get(EMAIL)).toMatchObject({
      failedLoginCount: 0,
      lockedUntil: null,
    });
  });

  it('tells the owner by email that the password changed, without the password in it', async () => {
    const scenario = buildScenario();
    const code = await requestResetCode(scenario);
    scenario.emails.sent.length = 0;

    await scenario.resetPassword.execute({ email: EMAIL, code, newPassword: NEW_PASSWORD });

    const notices = scenario.emails.messagesTo(EMAIL);
    expect(notices).toHaveLength(1);
    expect(notices[0]?.subject).toMatch(/contraseña/i);
    expect(JSON.stringify(notices)).not.toContain(NEW_PASSWORD);
  });

  it('accepts the code only once', async () => {
    const scenario = buildScenario();
    const code = await requestResetCode(scenario);
    await scenario.resetPassword.execute({ email: EMAIL, code, newPassword: NEW_PASSWORD });

    const error = await captureError(
      scenario.resetPassword.execute({ email: EMAIL, code, newPassword: 'another passphrase 99' }),
    );

    expect(error).toMatchObject(INVALID_CODE);
    expect(scenario.users.accounts.get(EMAIL)?.passwordHash).toBe(`hashed:${NEW_PASSWORD}`);
  });

  it('rejects a wrong code and leaves the password alone', async () => {
    const scenario = buildScenario();
    const code = await requestResetCode(scenario);
    const wrongCode = code === '000000' ? '000001' : '000000';

    const error = await captureError(
      scenario.resetPassword.execute({ email: EMAIL, code: wrongCode, newPassword: NEW_PASSWORD }),
    );

    expect(error).toMatchObject(INVALID_CODE);
    expect(scenario.users.accounts.get(EMAIL)?.passwordHash).toBe(`hashed:${OLD_PASSWORD}`);
  });

  it(`locks the code after ${String(MAX_VERIFICATION_ATTEMPTS)} wrong attempts`, async () => {
    const scenario = buildScenario();
    const code = await requestResetCode(scenario);
    const wrongCode = code === '000000' ? '000001' : '000000';
    for (let attempt = 0; attempt < MAX_VERIFICATION_ATTEMPTS; attempt += 1) {
      await captureError(
        scenario.resetPassword.execute({
          email: EMAIL,
          code: wrongCode,
          newPassword: NEW_PASSWORD,
        }),
      );
    }

    const error = await captureError(
      scenario.resetPassword.execute({ email: EMAIL, code, newPassword: NEW_PASSWORD }),
    );

    expect(error).toMatchObject(INVALID_CODE);
  });

  it('rejects an unknown email exactly like a wrong code', async () => {
    const scenario = buildScenario();

    const error = await captureError(
      scenario.resetPassword.execute({
        email: 'nobody@gmail.com',
        code: '123456',
        newPassword: NEW_PASSWORD,
      }),
    );

    expect(error).toMatchObject(INVALID_CODE);
  });

  it('does not accept an email-verification code as a reset code (codes are per purpose)', async () => {
    const scenario = buildScenario();
    await scenario.issuer.issue(
      { userId: USER_ID, email: EMAIL, fullName: 'Ana Pérez' },
      'email_verification',
    );
    const verificationCode = scenario.emails.lastCodeSentTo(EMAIL) ?? '';

    const error = await captureError(
      scenario.resetPassword.execute({
        email: EMAIL,
        code: verificationCode,
        newPassword: NEW_PASSWORD,
      }),
    );

    expect(error).toMatchObject(INVALID_CODE);
  });

  it('confirms the email as a side effect: reading the code proves the mailbox', async () => {
    const scenario = buildScenario();
    const account = scenario.users.accounts.get(EMAIL);
    const code = await requestResetCode(scenario);
    scenario.users.accounts.set(EMAIL, { ...account!, emailVerifiedAt: new Date() });

    await scenario.resetPassword.execute({ email: EMAIL, code, newPassword: NEW_PASSWORD });

    expect(scenario.users.accounts.get(EMAIL)?.emailVerifiedAt).toBeInstanceOf(Date);
  });

  describe('a bad new password', () => {
    it('is rejected naming the field, and the code stays usable so the person can try again', async () => {
      const scenario = buildScenario();
      const code = await requestResetCode(scenario);

      const weak = await captureError(
        scenario.resetPassword.execute({ email: EMAIL, code, newPassword: 'short' }),
      );
      await scenario.resetPassword.execute({ email: EMAIL, code, newPassword: NEW_PASSWORD });

      expect(weak).toMatchObject({ fieldErrors: [{ path: 'newPassword', code: 'too_short' }] });
      expect(scenario.users.accounts.get(EMAIL)?.passwordHash).toBe(`hashed:${NEW_PASSWORD}`);
    });

    it('rejects a breached password with PASSWORD_BREACHED and keeps the old one', async () => {
      const scenario = buildScenario();
      const code = await requestResetCode(scenario);

      const error = await captureError(
        scenario.resetPassword.execute({ email: EMAIL, code, newPassword: BREACHED_PASSWORD }),
      );

      expect(error).toMatchObject({ code: 'PASSWORD_BREACHED' });
      expect(scenario.users.accounts.get(EMAIL)?.passwordHash).toBe(`hashed:${OLD_PASSWORD}`);
    });
  });
});
