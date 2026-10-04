import { ConfigService } from '@nestjs/config';
import {
  FakeBreachedPasswordChecker,
  FakeVerificationCodeHasher,
  InMemoryUserAccountRepository,
  InMemoryVerificationCodeRepository,
  RecordingEmailSender,
} from '../../../../test/support/auth-fakes';
import { type Environment } from '../../../shared/config/environment.schema';
import { DomainError } from '../../../shared/errors/domain-error';
import { PasswordHasher } from '../../../shared/auth/password-hasher';
import { PasswordAcceptabilityChecker } from './password-acceptability.checker';
import { RegisterUserUseCase, type RegisterUserCommand } from './register-user.use-case';
import { RegistrationEligibilityChecker } from './registration-eligibility.checker';
import { VerificationCodeIssuer } from './verification-code-issuer';

const BREACHED_PASSWORD = 'password123456';
const VALID_COMMAND: RegisterUserCommand = {
  email: 'ana@gmail.com',
  password: 'correct horse battery staple',
  fullName: 'Ana Pérez',
  consents: { privacy: true, terms: true, marketing: false },
  clientIpHash: 'ip-hash',
};

function buildScenario(options: { areDisposableEmailsAllowed?: boolean } = {}) {
  const users = new InMemoryUserAccountRepository();
  const codes = new InMemoryVerificationCodeRepository();
  const emails = new RecordingEmailSender();
  const passwordHasher = {
    hash: (plain: string) => Promise.resolve(`hashed:${plain}`),
  } as unknown as PasswordHasher;
  const issuer = new VerificationCodeIssuer(codes, new FakeVerificationCodeHasher(), emails);
  const acceptability = new PasswordAcceptabilityChecker(
    new FakeBreachedPasswordChecker([BREACHED_PASSWORD]),
  );
  const configService = new ConfigService<Environment, true>({
    ALLOW_DISPOSABLE_EMAILS: options.areDisposableEmailsAllowed ?? false,
  });
  const eligibility = new RegistrationEligibilityChecker(configService, acceptability);
  const registerUser = new RegisterUserUseCase(users, passwordHasher, eligibility, issuer);
  return { users, codes, emails, registerUser };
}

async function captureError(action: Promise<unknown>): Promise<unknown> {
  try {
    await action;
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('RegisterUserUseCase', () => {
  describe('a new person', () => {
    it('creates an unverified account with a hashed password', async () => {
      const { users, registerUser } = buildScenario();

      await registerUser.execute(VALID_COMMAND);

      const account = users.accounts.get('ana@gmail.com');
      expect(account?.emailVerifiedAt).toBeNull();
      expect(account?.passwordHash).toBe('hashed:correct horse battery staple');
      expect(account?.fullName).toBe('Ana Pérez');
    });

    it('records the consents given, with the legal text version, including a declined marketing one', async () => {
      const { users, registerUser } = buildScenario();

      await registerUser.execute(VALID_COMMAND);

      const consents = users.accounts.get('ana@gmail.com')?.consents;
      expect(consents).toEqual([
        { kind: 'privacy', version: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), isGranted: true },
        { kind: 'terms', version: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), isGranted: true },
        {
          kind: 'marketing',
          version: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
          isGranted: false,
        },
      ]);
    });

    it('sends one email with a 6-digit code and never the password', async () => {
      const { emails, registerUser } = buildScenario();

      await registerUser.execute(VALID_COMMAND);

      expect(emails.messagesTo('ana@gmail.com')).toHaveLength(1);
      expect(emails.lastCodeSentTo('ana@gmail.com')).toMatch(/^\d{6}$/);
      expect(JSON.stringify(emails.sent)).not.toContain('correct horse');
    });
  });

  describe('what is required before creating an account', () => {
    it.each([
      ['the privacy policy', { privacy: false, terms: true, marketing: false }],
      ['the terms', { privacy: true, terms: false, marketing: false }],
    ])('answers CONSENT_REQUIRED without %s, and creates nothing', async (_name, consents) => {
      const { users, emails, registerUser } = buildScenario();

      const error = await captureError(registerUser.execute({ ...VALID_COMMAND, consents }));

      expect(error).toMatchObject({ code: 'CONSENT_REQUIRED', httpStatus: 400 });
      expect(users.accounts.size).toBe(0);
      expect(emails.sent).toHaveLength(0);
    });

    it('rejects a too-short password naming the field, and creates nothing', async () => {
      const { users, registerUser } = buildScenario();

      const error = await captureError(
        registerUser.execute({ ...VALID_COMMAND, password: 'short' }),
      );

      expect(error).toBeInstanceOf(DomainError);
      expect(error).toMatchObject({
        code: 'VALIDATION_FAILED',
        httpStatus: 400,
        fieldErrors: [{ path: 'password', code: 'too_short' }],
      });
      expect(users.accounts.size).toBe(0);
    });

    it('rejects a breached password with 422 PASSWORD_BREACHED', async () => {
      const { users, registerUser } = buildScenario();

      const error = await captureError(
        registerUser.execute({ ...VALID_COMMAND, password: BREACHED_PASSWORD }),
      );

      expect(error).toMatchObject({ code: 'PASSWORD_BREACHED', httpStatus: 422 });
      expect(users.accounts.size).toBe(0);
    });

    it('rejects a disposable email domain when they are not allowed', async () => {
      const { users, registerUser } = buildScenario({ areDisposableEmailsAllowed: false });

      const error = await captureError(
        registerUser.execute({ ...VALID_COMMAND, email: 'robin@yopmail.com' }),
      );

      expect(error).toMatchObject({ code: 'EMAIL_DOMAIN_NOT_ALLOWED', httpStatus: 422 });
      expect(users.accounts.size).toBe(0);
    });

    it('accepts a disposable email domain when they are allowed, as in development', async () => {
      const { users, registerUser } = buildScenario({ areDisposableEmailsAllowed: true });

      await registerUser.execute({ ...VALID_COMMAND, email: 'robin@yopmail.com' });

      expect(users.accounts.has('robin@yopmail.com')).toBe(true);
    });

    it('rejects a password containing the email name', async () => {
      const { registerUser } = buildScenario();

      const error = await captureError(
        registerUser.execute({
          ...VALID_COMMAND,
          email: 'anita@gmail.com',
          password: 'anita-forever-2026',
        }),
      );

      expect(error).toMatchObject({ fieldErrors: [{ path: 'password', code: 'contains_email' }] });
    });
  });

  describe('an email that already has an account (no enumeration)', () => {
    async function registerThenSeeExisting(isVerified: boolean) {
      const scenario = buildScenario();
      await scenario.registerUser.execute(VALID_COMMAND);
      if (isVerified) {
        const account = scenario.users.accounts.get('ana@gmail.com');
        await scenario.users.markEmailVerified(account?.id ?? '', new Date());
      }
      scenario.emails.sent.length = 0;
      scenario.codes.makeCodesOlderThanCooldown();
      return scenario;
    }

    it('answers the same way as for a new person: no error, nothing to tell them apart', async () => {
      const { registerUser } = await registerThenSeeExisting(true);

      await expect(registerUser.execute(VALID_COMMAND)).resolves.toBeUndefined();
    });

    it('verified: sends an "you already have an account" email and no code', async () => {
      const { emails, registerUser } = await registerThenSeeExisting(true);

      await registerUser.execute({ ...VALID_COMMAND, fullName: 'Someone Else' });

      const messages = emails.messagesTo('ana@gmail.com');
      expect(messages).toHaveLength(1);
      expect(messages[0]?.subject).toMatch(/ya tienes una cuenta/i);
      expect(emails.lastCodeSentTo('ana@gmail.com')).toBeUndefined();
    });

    it('unverified: sends a fresh code to the existing account', async () => {
      const { emails, registerUser } = await registerThenSeeExisting(false);

      await registerUser.execute(VALID_COMMAND);

      expect(emails.lastCodeSentTo('ana@gmail.com')).toMatch(/^\d{6}$/);
    });

    it('never lets a second registration overwrite the owner password or name', async () => {
      const { users, registerUser } = await registerThenSeeExisting(true);

      await registerUser.execute({
        ...VALID_COMMAND,
        password: 'attacker chosen passphrase',
        fullName: 'Attacker',
      });

      const account = users.accounts.get('ana@gmail.com');
      expect(account?.passwordHash).toBe('hashed:correct horse battery staple');
      expect(account?.fullName).toBe('Ana Pérez');
    });

    it('creates no second account', async () => {
      const { users, registerUser } = await registerThenSeeExisting(true);

      await registerUser.execute(VALID_COMMAND);

      expect(users.accounts.size).toBe(1);
    });
  });

  it('handles two simultaneous registrations of the same email without failing the loser', async () => {
    const { users, emails, registerUser } = buildScenario();
    await registerUser.execute(VALID_COMMAND);
    users.failNextCreateWithEmailTaken = true;
    emails.sent.length = 0;

    await expect(registerUser.execute(VALID_COMMAND)).resolves.toBeUndefined();
  });
});
