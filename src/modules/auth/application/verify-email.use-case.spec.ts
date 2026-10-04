import {
  FakeVerificationCodeHasher,
  InMemoryUserAccountRepository,
  InMemoryVerificationCodeRepository,
  RecordingEmailSender,
} from '../../../../test/support/auth-fakes';
import { MAX_VERIFICATION_ATTEMPTS } from '../domain/verification-code';
import { ResendEmailVerificationUseCase } from './resend-email-verification.use-case';
import { VerificationCodeChecker } from './verification-code-checker';
import { VerificationCodeIssuer } from './verification-code-issuer';
import { VerifyEmailUseCase } from './verify-email.use-case';

const EMAIL = 'ana@gmail.com';
const USER_ID = 'user-1';

function buildScenario() {
  const users = new InMemoryUserAccountRepository();
  users.seedAccount({
    id: USER_ID,
    email: EMAIL,
    fullName: 'Ana Pérez',
    passwordHash: 'hashed',
    emailVerifiedAt: null,
  });
  const codes = new InMemoryVerificationCodeRepository();
  const emails = new RecordingEmailSender();
  const hasher = new FakeVerificationCodeHasher();
  const issuer = new VerificationCodeIssuer(codes, hasher, emails);
  return {
    users,
    codes,
    emails,
    issuer,
    verifyEmail: new VerifyEmailUseCase(users, new VerificationCodeChecker(codes, hasher)),
    resendVerification: new ResendEmailVerificationUseCase(users, issuer),
  };
}

async function issueCode(scenario: ReturnType<typeof buildScenario>): Promise<string> {
  await scenario.issuer.issue(
    { userId: USER_ID, email: EMAIL, fullName: 'Ana Pérez' },
    'email_verification',
  );
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

describe('VerifyEmailUseCase', () => {
  it('marks the email as verified with the right code', async () => {
    const scenario = buildScenario();
    const code = await issueCode(scenario);

    await scenario.verifyEmail.execute({ email: EMAIL, code });

    expect(scenario.users.accounts.get(EMAIL)?.emailVerifiedAt).toBeInstanceOf(Date);
  });

  it('works only once: the same code cannot be used again', async () => {
    const scenario = buildScenario();
    const code = await issueCode(scenario);
    await scenario.verifyEmail.execute({ email: EMAIL, code });

    const error = await captureError(scenario.verifyEmail.execute({ email: EMAIL, code }));

    expect(error).toMatchObject(INVALID_CODE);
  });

  it('rejects a wrong code without verifying the account', async () => {
    const scenario = buildScenario();
    const code = await issueCode(scenario);
    const wrongCode = code === '000000' ? '000001' : '000000';

    const error = await captureError(
      scenario.verifyEmail.execute({ email: EMAIL, code: wrongCode }),
    );

    expect(error).toMatchObject(INVALID_CODE);
    expect(scenario.users.accounts.get(EMAIL)?.emailVerifiedAt).toBeNull();
  });

  it(`locks the code after ${String(MAX_VERIFICATION_ATTEMPTS)} wrong attempts: even the right one fails`, async () => {
    const scenario = buildScenario();
    const code = await issueCode(scenario);
    const wrongCode = code === '000000' ? '000001' : '000000';
    for (let attempt = 0; attempt < MAX_VERIFICATION_ATTEMPTS; attempt += 1) {
      await captureError(scenario.verifyEmail.execute({ email: EMAIL, code: wrongCode }));
    }

    const error = await captureError(scenario.verifyEmail.execute({ email: EMAIL, code }));

    expect(error).toMatchObject(INVALID_CODE);
    expect(scenario.users.accounts.get(EMAIL)?.emailVerifiedAt).toBeNull();
  });

  it('rejects an expired code', async () => {
    const scenario = buildScenario();
    const code = await issueCode(scenario);
    scenario.codes.expireActiveCodes();

    const error = await captureError(scenario.verifyEmail.execute({ email: EMAIL, code }));

    expect(error).toMatchObject(INVALID_CODE);
  });

  it('answers an unknown email exactly like a wrong code, so it cannot be used to find accounts', async () => {
    const scenario = buildScenario();

    const error = await captureError(
      scenario.verifyEmail.execute({ email: 'nobody@gmail.com', code: '123456' }),
    );

    expect(error).toMatchObject(INVALID_CODE);
  });

  it('answers an already verified account like a wrong code', async () => {
    const scenario = buildScenario();
    const code = await issueCode(scenario);
    await scenario.verifyEmail.execute({ email: EMAIL, code });

    const error = await captureError(
      scenario.verifyEmail.execute({ email: EMAIL, code: '123456' }),
    );

    expect(error).toMatchObject(INVALID_CODE);
  });

  it('invalidates the previous code when a new one is issued', async () => {
    const scenario = buildScenario();
    const firstCode = await issueCode(scenario);
    scenario.codes.makeCodesOlderThanCooldown();
    const secondCode = await issueCode(scenario);

    const withOldCode = await captureError(
      scenario.verifyEmail.execute({ email: EMAIL, code: firstCode }),
    );

    expect(secondCode).not.toBe(firstCode);
    expect(withOldCode).toMatchObject(INVALID_CODE);
  });
});

describe('ResendEmailVerificationUseCase', () => {
  it('sends a new code to an unverified account once the cooldown has passed', async () => {
    const scenario = buildScenario();
    await issueCode(scenario);
    scenario.codes.makeCodesOlderThanCooldown();
    scenario.emails.sent.length = 0;

    await scenario.resendVerification.execute({ email: EMAIL });

    expect(scenario.emails.messagesTo(EMAIL)).toHaveLength(1);
  });

  it('sends nothing while the previous code is recent: it stops mail flooding', async () => {
    const scenario = buildScenario();
    await issueCode(scenario);
    scenario.emails.sent.length = 0;

    await scenario.resendVerification.execute({ email: EMAIL });

    expect(scenario.emails.sent).toHaveLength(0);
  });

  it('does nothing, without error, for an unknown email', async () => {
    const scenario = buildScenario();

    await expect(
      scenario.resendVerification.execute({ email: 'nobody@gmail.com' }),
    ).resolves.toBeUndefined();
    expect(scenario.emails.sent).toHaveLength(0);
  });

  it('does nothing, without error, for an account that is already verified', async () => {
    const scenario = buildScenario();
    await scenario.users.markEmailVerified(USER_ID, new Date());

    await expect(scenario.resendVerification.execute({ email: EMAIL })).resolves.toBeUndefined();
    expect(scenario.emails.sent).toHaveLength(0);
  });
});
