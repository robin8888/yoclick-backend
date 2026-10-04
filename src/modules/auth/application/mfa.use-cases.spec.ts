import { ConfigService } from '@nestjs/config';
import * as OTPAuth from 'otpauth';
import {
  FakeVerificationCodeHasher,
  InMemorySessionRepository,
  InMemoryMfaRepository,
  InMemoryUserAccountRepository,
  RecordingEmailSender,
} from '../../../../test/support/auth-fakes';
import { type AccessTokenService } from '../../../shared/auth/access-token.service';
import { type PasswordHasher } from '../../../shared/auth/password-hasher';
import { type Environment } from '../../../shared/config/environment.schema';
import { SecretEncryptor } from '../../../shared/crypto/secret-encryptor';
import { DomainError } from '../../../shared/errors/domain-error';
import { MAX_FAILED_LOGIN_ATTEMPTS } from '../domain/login-policy';
import { TotpEngine } from '../infrastructure/totp-engine';
import { AccountSecurityNotifier } from './account-security-notifier';
import { ConfirmTotpUseCase } from './confirm-totp.use-case';
import { DisableMfaUseCase } from './disable-mfa.use-case';
import { GetMfaStatusUseCase } from './get-mfa-status.use-case';
import { LoginFailureRecorder } from './login-failure-recorder';
import { MfaActivator } from './mfa-activator';
import { ReauthenticationChecker } from './reauthentication.checker';
import { RecoveryCodeService } from './recovery-code-service';
import { RegenerateRecoveryCodesUseCase } from './regenerate-recovery-codes.use-case';
import { SecondFactorVerifier } from './second-factor-verifier';
import { SessionIssuer } from './session-issuer';
import { SetupTotpUseCase } from './setup-totp.use-case';
import { VerifyMfaLoginUseCase } from './verify-mfa-login.use-case';

const USER_ID = 'user-1';
const EMAIL = 'ana@gmail.com';
const PASSWORD = 'correct horse battery staple';
const STEP_MS = 30_000;

function buildScenario() {
  const users = new InMemoryUserAccountRepository();
  users.seedAccount({
    id: USER_ID,
    email: EMAIL,
    fullName: 'Ana Pérez',
    passwordHash: `hashed:${PASSWORD}`,
    emailVerifiedAt: new Date(),
  });
  const mfa = new InMemoryMfaRepository();
  const sessions = new InMemorySessionRepository();
  const emails = new RecordingEmailSender();
  const engine = new TotpEngine();
  const encryptor = new SecretEncryptor(
    new ConfigService<Environment, true>({
      MFA_ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 5).toString('base64'),
    }),
  );
  const notifier = new AccountSecurityNotifier(emails);
  const failureRecorder = new LoginFailureRecorder(users, notifier);
  const recoveryCodes = new RecoveryCodeService(new FakeVerificationCodeHasher());
  const passwordHasher = {
    verify: (storedHash: string, plain: string) =>
      Promise.resolve(storedHash === `hashed:${plain}`),
    spendTimeLikeAVerification: () => Promise.resolve(),
  } as unknown as PasswordHasher;
  const reauth = new ReauthenticationChecker(users, passwordHasher, failureRecorder);
  const verifier = new SecondFactorVerifier(mfa, engine, encryptor, recoveryCodes, failureRecorder);
  const accessTokens = {
    issue: (userId: string, options?: { isMfaVerified: boolean }) =>
      Promise.resolve({
        token: `access-${userId}-${String(options?.isMfaVerified ?? false)}`,
        expiresAt: new Date(Date.now() + 600_000),
      }),
    issueMfaChallenge: (userId: string) =>
      Promise.resolve({ token: `challenge-${userId}`, expiresAt: new Date(Date.now() + 300_000) }),
    verifyMfaChallenge: (token: string) =>
      token.startsWith('challenge-')
        ? Promise.resolve({ userId: token.slice('challenge-'.length) })
        : Promise.reject(new DomainError('SESSION_INVALID', 401)),
  } as unknown as AccessTokenService;
  const issuer = new SessionIssuer(sessions, accessTokens);
  return {
    users,
    mfa,
    sessions,
    emails,
    engine,
    encryptor,
    setup: new SetupTotpUseCase(reauth, mfa, engine, encryptor),
    confirm: new ConfirmTotpUseCase(
      users,
      verifier,
      new MfaActivator(mfa, recoveryCodes, notifier),
    ),
    verifyLogin: new VerifyMfaLoginUseCase(users, verifier, issuer),
    disable: new DisableMfaUseCase(reauth, verifier, mfa, sessions, notifier),
    regenerate: new RegenerateRecoveryCodesUseCase(reauth, verifier, recoveryCodes, mfa),
    status: new GetMfaStatusUseCase(mfa),
  };
}

type Scenario = ReturnType<typeof buildScenario>;

function codeFor(secret: string, atMs = Date.now()): string {
  return new OTPAuth.TOTP({
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  }).generate({ timestamp: atMs });
}

async function captureError(action: Promise<unknown>): Promise<unknown> {
  try {
    await action;
  } catch (error) {
    return error;
  }
  return undefined;
}

/** Deja el segundo factor activado y devuelve el secreto y los códigos de recuperación. */
async function enableSecondFactor(
  scenario: Scenario,
): Promise<{ secret: string; recoveryCodes: readonly string[] }> {
  const { secret } = await scenario.setup.execute(USER_ID, PASSWORD);
  const { recoveryCodes } = await scenario.confirm.execute(USER_ID, codeFor(secret));
  // El código con el que se activó cuenta como usado: los siguientes tests usan intervalos posteriores.
  return { secret, recoveryCodes };
}

describe('setting up the second factor', () => {
  it('returns the secret and the otpauth URI, and stores the secret encrypted', async () => {
    const scenario = buildScenario();

    const result = await scenario.setup.execute(USER_ID, PASSWORD);

    expect(result.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(result.provisioningUri).toContain(`secret=${result.secret}`);
    const stored = await scenario.mfa.findFactor(USER_ID);
    expect(stored?.encryptedSecret).not.toContain(result.secret);
    expect(scenario.encryptor.decrypt(stored?.encryptedSecret ?? '')).toBe(result.secret);
  });

  it('asks for the password again (SEC-12) and answers 403 when it is wrong', async () => {
    const scenario = buildScenario();

    const error = await captureError(scenario.setup.execute(USER_ID, 'not the password'));

    expect(error).toMatchObject({ code: 'REAUTHENTICATION_FAILED', httpStatus: 403 });
    expect(scenario.mfa.factors.size).toBe(0);
  });

  it('is not active until confirmed: the first code is what proves the app has the secret', async () => {
    const scenario = buildScenario();

    await scenario.setup.execute(USER_ID, PASSWORD);

    expect(await scenario.status.execute(USER_ID)).toEqual({
      isEnabled: false,
      recoveryCodesRemaining: 0,
    });
  });

  it('lets a half-finished setup be restarted with a fresh secret', async () => {
    const scenario = buildScenario();
    const first = await scenario.setup.execute(USER_ID, PASSWORD);

    const second = await scenario.setup.execute(USER_ID, PASSWORD);

    expect(second.secret).not.toBe(first.secret);
  });

  it('refuses to replace an active second factor: it must be disabled first', async () => {
    const scenario = buildScenario();
    await enableSecondFactor(scenario);

    const error = await captureError(scenario.setup.execute(USER_ID, PASSWORD));

    expect(error).toMatchObject({ code: 'MFA_ALREADY_ENABLED', httpStatus: 409 });
  });
});

describe('confirming the second factor', () => {
  it('activates it with a valid code and hands over ten recovery codes', async () => {
    const scenario = buildScenario();
    const { secret } = await scenario.setup.execute(USER_ID, PASSWORD);

    const { recoveryCodes } = await scenario.confirm.execute(USER_ID, codeFor(secret));

    expect(recoveryCodes).toHaveLength(10);
    expect(await scenario.status.execute(USER_ID)).toEqual({
      isEnabled: true,
      recoveryCodesRemaining: 10,
    });
  });

  it('stores only the hash of each recovery code', async () => {
    const scenario = buildScenario();
    const { secret } = await scenario.setup.execute(USER_ID, PASSWORD);

    const { recoveryCodes } = await scenario.confirm.execute(USER_ID, codeFor(secret));

    const stored = JSON.stringify([...scenario.mfa.factors.values()]);
    for (const code of recoveryCodes) expect(stored).not.toContain(code);
  });

  it('rejects a wrong code with 403 and counts it as a failed attempt', async () => {
    const scenario = buildScenario();
    const { secret } = await scenario.setup.execute(USER_ID, PASSWORD);
    const right = codeFor(secret);
    const wrong = right === '000000' ? '000001' : '000000';

    const error = await captureError(scenario.confirm.execute(USER_ID, wrong));

    expect(error).toMatchObject({ code: 'MFA_CODE_INVALID', httpStatus: 403 });
    expect(scenario.users.accounts.get(EMAIL)?.failedLoginCount).toBe(1);
    expect((await scenario.mfa.findFactor(USER_ID))?.isConfirmed).toBe(false);
  });

  it('answers MFA_NOT_ENABLED when no setup was started', async () => {
    const scenario = buildScenario();

    const error = await captureError(scenario.confirm.execute(USER_ID, '123456'));

    expect(error).toMatchObject({ code: 'MFA_NOT_ENABLED', httpStatus: 409 });
  });

  it('cannot be confirmed twice', async () => {
    const scenario = buildScenario();
    const { secret } = await scenario.setup.execute(USER_ID, PASSWORD);
    await scenario.confirm.execute(USER_ID, codeFor(secret));

    const error = await captureError(scenario.confirm.execute(USER_ID, codeFor(secret)));

    expect(error).toMatchObject({ code: 'MFA_NOT_ENABLED' });
  });

  it('tells the owner by email that the second factor was turned on', async () => {
    const scenario = buildScenario();

    await enableSecondFactor(scenario);

    expect(scenario.emails.messagesTo(EMAIL)[0]?.subject).toMatch(/activado la verificación/i);
  });
});

describe('completing a login with the second factor', () => {
  const NEXT_STEP_MS = STEP_MS;

  it('opens a session marked as second-factor verified, with a valid app code', async () => {
    const scenario = buildScenario();
    const { secret } = await enableSecondFactor(scenario);

    const result = await scenario.verifyLogin.execute({
      mfaToken: `challenge-${USER_ID}`,
      code: codeFor(secret, Date.now() + NEXT_STEP_MS),
      deviceName: 'iPhone',
    });

    expect(result.kind).toBe('authenticated');
    expect(result.accessToken).toBe(`access-${USER_ID}-true`);
    expect(scenario.sessions.tokens[0]?.isMfaVerified).toBe(true);
  });

  it('never accepts the same code twice, not even inside its 30 seconds (anti-replay)', async () => {
    const scenario = buildScenario();
    const { secret } = await enableSecondFactor(scenario);
    const code = codeFor(secret, Date.now() + NEXT_STEP_MS);
    await scenario.verifyLogin.execute({
      mfaToken: `challenge-${USER_ID}`,
      code,
      deviceName: null,
    });

    const replay = await captureError(
      scenario.verifyLogin.execute({ mfaToken: `challenge-${USER_ID}`, code, deviceName: null }),
    );

    expect(replay).toMatchObject({ code: 'MFA_CODE_INVALID', httpStatus: 401 });
  });

  it('rejects the code used to activate the factor: it already counts as spent', async () => {
    const scenario = buildScenario();
    const { secret } = await scenario.setup.execute(USER_ID, PASSWORD);
    const activationCode = codeFor(secret);
    await scenario.confirm.execute(USER_ID, activationCode);

    const error = await captureError(
      scenario.verifyLogin.execute({
        mfaToken: `challenge-${USER_ID}`,
        code: activationCode,
        deviceName: null,
      }),
    );

    expect(error).toMatchObject({ code: 'MFA_CODE_INVALID' });
  });

  it('rejects a code from an earlier time step than the last one used', async () => {
    const scenario = buildScenario();
    const { secret } = await enableSecondFactor(scenario);
    await scenario.verifyLogin.execute({
      mfaToken: `challenge-${USER_ID}`,
      code: codeFor(secret, Date.now() + NEXT_STEP_MS),
      deviceName: null,
    });

    const error = await captureError(
      scenario.verifyLogin.execute({
        mfaToken: `challenge-${USER_ID}`,
        code: codeFor(secret, Date.now() - NEXT_STEP_MS),
        deviceName: null,
      }),
    );

    expect(error).toMatchObject({ code: 'MFA_CODE_INVALID' });
  });

  it('rejects a wrong code with 401 and counts it towards the same lockout as the password', async () => {
    const scenario = buildScenario();
    const { secret } = await enableSecondFactor(scenario);
    const wrong = codeFor(secret, Date.now() + NEXT_STEP_MS) === '000000' ? '000001' : '000000';

    const error = await captureError(
      scenario.verifyLogin.execute({
        mfaToken: `challenge-${USER_ID}`,
        code: wrong,
        deviceName: null,
      }),
    );

    expect(error).toMatchObject({ code: 'MFA_CODE_INVALID', httpStatus: 401 });
    expect(scenario.users.accounts.get(EMAIL)?.failedLoginCount).toBe(1);
  });

  it('locks the account after repeated wrong codes, and the right code no longer helps', async () => {
    const scenario = buildScenario();
    const { secret } = await enableSecondFactor(scenario);
    const right = codeFor(secret, Date.now() + NEXT_STEP_MS);
    const wrong = right === '000000' ? '000001' : '000000';
    for (let attempt = 0; attempt < MAX_FAILED_LOGIN_ATTEMPTS; attempt += 1) {
      await captureError(
        scenario.verifyLogin.execute({
          mfaToken: `challenge-${USER_ID}`,
          code: wrong,
          deviceName: null,
        }),
      );
    }

    const error = await captureError(
      scenario.verifyLogin.execute({
        mfaToken: `challenge-${USER_ID}`,
        code: right,
        deviceName: null,
      }),
    );

    expect(error).toMatchObject({ code: 'MFA_CODE_INVALID' });
    expect(scenario.sessions.tokens).toHaveLength(0);
  });

  it('rejects a challenge that is not valid', async () => {
    const scenario = buildScenario();

    const error = await captureError(
      scenario.verifyLogin.execute({
        mfaToken: 'not-a-challenge',
        code: '123456',
        deviceName: null,
      }),
    );

    expect(error).toMatchObject({ code: 'SESSION_INVALID', httpStatus: 401 });
  });

  it('rejects an attempt that brings neither a code nor a recovery code', async () => {
    const scenario = buildScenario();
    await enableSecondFactor(scenario);

    const error = await captureError(
      scenario.verifyLogin.execute({ mfaToken: `challenge-${USER_ID}`, deviceName: null }),
    );

    expect(error).toMatchObject({ code: 'MFA_CODE_INVALID' });
  });

  describe('recovery codes', () => {
    it('open a session, and each works exactly once', async () => {
      const scenario = buildScenario();
      const { recoveryCodes } = await enableSecondFactor(scenario);
      const recoveryCode = recoveryCodes[0] ?? '';
      await scenario.verifyLogin.execute({
        mfaToken: `challenge-${USER_ID}`,
        recoveryCode,
        deviceName: null,
      });

      const reuse = await captureError(
        scenario.verifyLogin.execute({
          mfaToken: `challenge-${USER_ID}`,
          recoveryCode,
          deviceName: null,
        }),
      );

      expect(reuse).toMatchObject({ code: 'MFA_CODE_INVALID' });
      expect(await scenario.status.execute(USER_ID)).toMatchObject({ recoveryCodesRemaining: 9 });
    });

    it('can be typed in lower case and without the dash', async () => {
      const scenario = buildScenario();
      const { recoveryCodes } = await enableSecondFactor(scenario);
      const typed = (recoveryCodes[1] ?? '').toLowerCase().replace('-', '');

      const result = await scenario.verifyLogin.execute({
        mfaToken: `challenge-${USER_ID}`,
        recoveryCode: typed,
        deviceName: null,
      });

      expect(result.kind).toBe('authenticated');
    });

    it('rejects a made-up recovery code', async () => {
      const scenario = buildScenario();
      await enableSecondFactor(scenario);

      const error = await captureError(
        scenario.verifyLogin.execute({
          mfaToken: `challenge-${USER_ID}`,
          recoveryCode: 'AAAAA-AAAAA',
          deviceName: null,
        }),
      );

      expect(error).toMatchObject({ code: 'MFA_CODE_INVALID' });
    });
  });
});

describe('disabling the second factor', () => {
  it('needs the password and a valid code, then removes it, closes every session and warns by email', async () => {
    const scenario = buildScenario();
    const { secret } = await enableSecondFactor(scenario);
    await scenario.sessions.create({
      id: 'token-1',
      userId: USER_ID,
      familyId: 'family-1',
      tokenHash: 'hash-1',
      deviceName: null,
      isMfaVerified: true,
      expiresAt: new Date(Date.now() + 1_000_000),
    });
    scenario.emails.sent.length = 0;

    await scenario.disable.execute({
      userId: USER_ID,
      password: PASSWORD,
      code: codeFor(secret, Date.now() + STEP_MS),
    });

    expect(await scenario.status.execute(USER_ID)).toEqual({
      isEnabled: false,
      recoveryCodesRemaining: 0,
    });
    expect(scenario.sessions.activeTokensOf(USER_ID)).toBe(0);
    expect(scenario.emails.messagesTo(EMAIL)[0]?.subject).toMatch(/desactivado la verificación/i);
  });

  it('refuses without the right password', async () => {
    const scenario = buildScenario();
    const { secret } = await enableSecondFactor(scenario);

    const error = await captureError(
      scenario.disable.execute({
        userId: USER_ID,
        password: 'not the password',
        code: codeFor(secret, Date.now() + STEP_MS),
      }),
    );

    expect(error).toMatchObject({ code: 'REAUTHENTICATION_FAILED' });
    expect((await scenario.status.execute(USER_ID)).isEnabled).toBe(true);
  });

  it('refuses without a valid code: a stolen access token plus the password is not enough', async () => {
    const scenario = buildScenario();
    const { secret } = await enableSecondFactor(scenario);
    const wrong = codeFor(secret, Date.now() + STEP_MS) === '000000' ? '000001' : '000000';

    const error = await captureError(
      scenario.disable.execute({ userId: USER_ID, password: PASSWORD, code: wrong }),
    );

    expect(error).toMatchObject({ code: 'MFA_CODE_INVALID', httpStatus: 403 });
    expect((await scenario.status.execute(USER_ID)).isEnabled).toBe(true);
  });

  it('refuses an owner or administrator: their role requires it', async () => {
    const scenario = buildScenario();
    const { secret } = await enableSecondFactor(scenario);
    scenario.mfa.administrativeUserIds.add(USER_ID);

    const error = await captureError(
      scenario.disable.execute({
        userId: USER_ID,
        password: PASSWORD,
        code: codeFor(secret, Date.now() + STEP_MS),
      }),
    );

    expect(error).toMatchObject({ code: 'MFA_REQUIRED_FOR_ROLE', httpStatus: 409 });
    expect((await scenario.status.execute(USER_ID)).isEnabled).toBe(true);
  });

  it('answers MFA_NOT_ENABLED when there is nothing to disable', async () => {
    const scenario = buildScenario();

    const error = await captureError(
      scenario.disable.execute({ userId: USER_ID, password: PASSWORD, code: '123456' }),
    );

    expect(error).toMatchObject({ code: 'MFA_NOT_ENABLED' });
  });
});

describe('regenerating recovery codes', () => {
  it('replaces the ten codes: the old ones stop working', async () => {
    const scenario = buildScenario();
    const { secret, recoveryCodes } = await enableSecondFactor(scenario);

    const fresh = await scenario.regenerate.execute({
      userId: USER_ID,
      password: PASSWORD,
      code: codeFor(secret, Date.now() + STEP_MS),
    });

    const withOldCode = await captureError(
      scenario.verifyLogin.execute({
        mfaToken: `challenge-${USER_ID}`,
        recoveryCode: recoveryCodes[0] ?? '',
        deviceName: null,
      }),
    );
    expect(fresh).toHaveLength(10);
    expect(fresh).not.toEqual(recoveryCodes);
    expect(withOldCode).toMatchObject({ code: 'MFA_CODE_INVALID' });
  });

  it('needs the password and a valid code', async () => {
    const scenario = buildScenario();
    await enableSecondFactor(scenario);

    const error = await captureError(
      scenario.regenerate.execute({ userId: USER_ID, password: PASSWORD, code: '000000' }),
    );

    expect(error).toMatchObject({ code: 'MFA_CODE_INVALID' });
  });
});
