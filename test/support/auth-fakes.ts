import { type BreachedPasswordChecker } from '../../src/modules/auth/application/ports/breached-password.checker';
import {
  type MfaConfirmation,
  type MfaFactorState,
  type MfaRepository,
} from '../../src/modules/auth/application/ports/mfa.repository';
import {
  type NewRefreshToken,
  type RotationRequest,
  type SessionRepository,
  type StoredRefreshToken,
} from '../../src/modules/auth/application/ports/session.repository';
import {
  type CreateUserAccountResult,
  type FailedLoginOutcome,
  type LockoutPolicy,
  type NewUserAccount,
  type UserAccount,
  type UserAccountRepository,
} from '../../src/modules/auth/application/ports/user-account.repository';
import { type VerificationCodeHasher } from '../../src/modules/auth/application/ports/verification-code.hasher';
import {
  type ActiveVerificationCode,
  type CodeReference,
  type NewVerificationCode,
  type VerificationCodeRepository,
  type VerificationPurposeName,
} from '../../src/modules/auth/application/ports/verification-code.repository';
import { type EmailMessage, type EmailSender } from '../../src/shared/email/email-sender';

/** Dobles en memoria de los puertos de autenticación, para probar los casos de uso sin base de datos. */

export class InMemoryUserAccountRepository implements UserAccountRepository {
  readonly accounts = new Map<string, UserAccount & { consents: NewUserAccount['consents'] }>();
  /** Para simular que otra petición creó la cuenta justo antes (carrera). */
  failNextCreateWithEmailTaken = false;

  findByEmail(email: string): Promise<UserAccount | null> {
    return Promise.resolve(this.accounts.get(email.toLowerCase()) ?? null);
  }

  create(newUser: NewUserAccount): Promise<CreateUserAccountResult> {
    const key = newUser.email.toLowerCase();
    if (this.failNextCreateWithEmailTaken || this.accounts.has(key)) {
      this.failNextCreateWithEmailTaken = false;
      return Promise.resolve('email-taken');
    }
    this.accounts.set(key, {
      id: newUser.id,
      email: newUser.email,
      fullName: newUser.fullName,
      passwordHash: newUser.passwordHash,
      emailVerifiedAt: null,
      failedLoginCount: 0,
      lockedUntil: null,
      consents: newUser.consents,
    });
    return Promise.resolve('created');
  }

  changePassword(userId: string, newPasswordHash: string, changedAt: Date): Promise<void> {
    for (const [key, account] of this.accounts) {
      if (account.id !== userId) continue;
      this.accounts.set(key, {
        ...account,
        passwordHash: newPasswordHash,
        failedLoginCount: 0,
        lockedUntil: null,
        emailVerifiedAt: account.emailVerifiedAt ?? changedAt,
      });
    }
    return Promise.resolve();
  }

  findById(userId: string): Promise<UserAccount | null> {
    const found = [...this.accounts.values()].find((account) => account.id === userId);
    return Promise.resolve(found ?? null);
  }

  recordFailedLogin(userId: string, policy: LockoutPolicy): Promise<FailedLoginOutcome> {
    for (const [key, account] of this.accounts) {
      if (account.id !== userId) continue;
      const failedLoginCount = account.failedLoginCount + 1;
      const isNowLocked = failedLoginCount >= policy.maxFailedAttempts;
      this.accounts.set(key, {
        ...account,
        failedLoginCount: isNowLocked ? 0 : failedLoginCount,
        lockedUntil: isNowLocked
          ? new Date(policy.now.getTime() + policy.lockDurationMs)
          : account.lockedUntil,
      });
      return Promise.resolve({ isNowLocked });
    }
    return Promise.resolve({ isNowLocked: false });
  }

  recordSuccessfulLogin(userId: string, now: Date, upgradedPasswordHash?: string): Promise<void> {
    for (const [key, account] of this.accounts) {
      if (account.id !== userId) continue;
      this.accounts.set(key, {
        ...account,
        failedLoginCount: 0,
        lockedUntil: null,
        passwordHash: upgradedPasswordHash ?? account.passwordHash,
      });
      this.lastLoginAt.set(userId, now);
    }
    return Promise.resolve();
  }

  readonly lastLoginAt = new Map<string, Date>();

  markEmailVerified(userId: string, verifiedAt: Date): Promise<void> {
    for (const [key, account] of this.accounts) {
      if (account.id === userId)
        this.accounts.set(key, { ...account, emailVerifiedAt: verifiedAt });
    }
    return Promise.resolve();
  }

  /** Para preparar una cuenta ya existente; los campos de bloqueo son opcionales. */
  seedAccount(
    account: Omit<UserAccount, 'failedLoginCount' | 'lockedUntil'> &
      Partial<Pick<UserAccount, 'failedLoginCount' | 'lockedUntil'>>,
  ): void {
    this.accounts.set(account.email.toLowerCase(), {
      failedLoginCount: 0,
      lockedUntil: null,
      ...account,
      consents: [],
    });
  }
}

interface StoredCode extends ActiveVerificationCode {
  readonly userId: string;
  readonly purpose: VerificationPurposeName;
  readonly expiresAt: Date;
  attemptCount: number;
  consumedAt: Date | null;
}

export class InMemoryVerificationCodeRepository implements VerificationCodeRepository {
  readonly codes: StoredCode[] = [];
  private nextId = 1;

  replaceActiveCode(newCode: NewVerificationCode): Promise<void> {
    for (const stored of this.codes) {
      if (stored.userId === newCode.userId && stored.purpose === newCode.purpose) {
        stored.consumedAt ??= new Date();
      }
    }
    this.codes.push({
      id: String(this.nextId++),
      userId: newCode.userId,
      purpose: newCode.purpose,
      codeHash: newCode.codeHash,
      expiresAt: newCode.expiresAt,
      createdAt: new Date(),
      attemptCount: 0,
      consumedAt: null,
    });
    return Promise.resolve();
  }

  findActiveCode(
    userId: string,
    purpose: VerificationPurposeName,
    now: Date,
  ): Promise<ActiveVerificationCode | null> {
    const active = this.codes
      .filter(
        (stored) =>
          stored.userId === userId &&
          stored.purpose === purpose &&
          stored.consumedAt === null &&
          stored.expiresAt > now,
      )
      .at(-1);
    return Promise.resolve(active ?? null);
  }

  registerAttempt(reference: CodeReference): Promise<number> {
    const stored = this.codes.find((candidate) => candidate.id === reference.codeId);
    if (!stored) return Promise.resolve(0);
    stored.attemptCount += 1;
    return Promise.resolve(stored.attemptCount);
  }

  consume(reference: CodeReference, consumedAt: Date): Promise<boolean> {
    const stored = this.codes.find((candidate) => candidate.id === reference.codeId);
    if (!stored || stored.consumedAt !== null) return Promise.resolve(false);
    stored.consumedAt = consumedAt;
    return Promise.resolve(true);
  }

  /** Para tests de caducidad: envejece el código vigente. */
  expireActiveCodes(): void {
    for (const stored of this.codes) (stored as { expiresAt: Date }).expiresAt = new Date(0);
  }

  /** Para tests del enfriamiento entre envíos. */
  makeCodesOlderThanCooldown(): void {
    for (const stored of this.codes) {
      (stored as { createdAt: Date }).createdAt = new Date(Date.now() - 120_000);
    }
  }
}

export class RecordingEmailSender implements EmailSender {
  readonly sent: EmailMessage[] = [];
  shouldFail = false;

  send(message: EmailMessage): Promise<void> {
    if (this.shouldFail) return Promise.reject(new Error('provider down'));
    this.sent.push(message);
    return Promise.resolve();
  }

  /** El último código de 6 dígitos enviado a esa dirección. */
  lastCodeSentTo(email: string): string | undefined {
    const message = [...this.sent].reverse().find((candidate) => candidate.to === email);
    return /\b(\d{6})\b/.exec(message?.textBody ?? '')?.[1];
  }

  messagesTo(email: string): EmailMessage[] {
    return this.sent.filter((message) => message.to === email);
  }
}

export class FakeVerificationCodeHasher implements VerificationCodeHasher {
  hash(code: string): string {
    return `hash:${code}`;
  }

  matches(code: string, storedHash: string): boolean {
    return storedHash === `hash:${code}`;
  }
}

export class FakeBreachedPasswordChecker implements BreachedPasswordChecker {
  constructor(private readonly breachedPasswords: readonly string[] = []) {}

  isBreached(plainPassword: string): Promise<boolean> {
    return Promise.resolve(this.breachedPasswords.includes(plainPassword));
  }
}

interface StoredSessionToken extends StoredRefreshToken {
  readonly tokenHash: string;
  readonly deviceName: string | null;
  replacedById: string | null;
  revokedAtMutable: Date | null;
}

export class InMemorySessionRepository implements SessionRepository {
  readonly tokens: StoredSessionToken[] = [];

  create(newToken: NewRefreshToken): Promise<void> {
    this.tokens.push({ ...newToken, revokedAt: null, revokedAtMutable: null, replacedById: null });
    return Promise.resolve();
  }

  findByTokenHash(tokenHash: string): Promise<StoredRefreshToken | null> {
    const stored = this.tokens.find((candidate) => candidate.tokenHash === tokenHash);
    return Promise.resolve(stored ? this.asStored(stored) : null);
  }

  rotate(request: RotationRequest): Promise<boolean> {
    const current = this.tokens.find((candidate) => candidate.id === request.currentTokenId);
    if (!current || current.revokedAtMutable !== null) return Promise.resolve(false);
    current.revokedAtMutable = request.now;
    current.replacedById = request.newToken.id;
    this.tokens.push({
      ...request.newToken,
      revokedAt: null,
      revokedAtMutable: null,
      replacedById: null,
    });
    return Promise.resolve(true);
  }

  revokeFamily(familyId: string, now: Date): Promise<void> {
    for (const token of this.tokens) {
      if (token.familyId === familyId) token.revokedAtMutable ??= now;
    }
    return Promise.resolve();
  }

  revokeAllOfUser(userId: string, now: Date): Promise<void> {
    for (const token of this.tokens) {
      if (token.userId === userId) token.revokedAtMutable ??= now;
    }
    return Promise.resolve();
  }

  activeTokensOf(userId: string): number {
    return this.tokens.filter((token) => token.userId === userId && token.revokedAtMutable === null)
      .length;
  }

  private asStored(token: StoredSessionToken): StoredRefreshToken {
    return {
      id: token.id,
      userId: token.userId,
      familyId: token.familyId,
      expiresAt: token.expiresAt,
      isMfaVerified: token.isMfaVerified,
      revokedAt: token.revokedAtMutable,
    };
  }
}

interface StoredFactor {
  encryptedSecret: string;
  isConfirmed: boolean;
  lastUsedStep: number | null;
  recoveryCodes: { codeHash: string; usedAt: Date | null }[];
}

export class InMemoryMfaRepository implements MfaRepository {
  readonly factors = new Map<string, StoredFactor>();
  /** Personas que tienen un rol de propietaria o administración (para probar que no pueden desactivarlo). */
  readonly administrativeUserIds = new Set<string>();

  findFactor(userId: string): Promise<MfaFactorState | null> {
    const factor = this.factors.get(userId);
    return Promise.resolve(
      factor
        ? {
            encryptedSecret: factor.encryptedSecret,
            isConfirmed: factor.isConfirmed,
            lastUsedStep: factor.lastUsedStep,
          }
        : null,
    );
  }

  saveUnconfirmedFactor(userId: string, encryptedSecret: string): Promise<boolean> {
    if (this.factors.get(userId)?.isConfirmed) return Promise.resolve(false);
    this.factors.set(userId, {
      encryptedSecret,
      isConfirmed: false,
      lastUsedStep: null,
      recoveryCodes: [],
    });
    return Promise.resolve(true);
  }

  confirmFactor(userId: string, confirmation: MfaConfirmation): Promise<boolean> {
    const factor = this.factors.get(userId);
    if (!factor || factor.isConfirmed) return Promise.resolve(false);
    factor.isConfirmed = true;
    factor.lastUsedStep = confirmation.step;
    factor.recoveryCodes = confirmation.recoveryCodeHashes.map((codeHash) => ({
      codeHash,
      usedAt: null,
    }));
    return Promise.resolve(true);
  }

  markStepUsed(userId: string, step: number): Promise<boolean> {
    const factor = this.factors.get(userId);
    if (!factor || (factor.lastUsedStep !== null && step <= factor.lastUsedStep)) {
      return Promise.resolve(false);
    }
    factor.lastUsedStep = step;
    return Promise.resolve(true);
  }

  consumeRecoveryCode(userId: string, codeHash: string, usedAt: Date): Promise<boolean> {
    const code = this.factors
      .get(userId)
      ?.recoveryCodes.find(
        (candidate) => candidate.codeHash === codeHash && candidate.usedAt === null,
      );
    if (!code) return Promise.resolve(false);
    code.usedAt = usedAt;
    return Promise.resolve(true);
  }

  replaceRecoveryCodes(userId: string, codeHashes: readonly string[]): Promise<void> {
    const factor = this.factors.get(userId);
    if (factor) factor.recoveryCodes = codeHashes.map((codeHash) => ({ codeHash, usedAt: null }));
    return Promise.resolve();
  }

  countUnusedRecoveryCodes(userId: string): Promise<number> {
    const codes = this.factors.get(userId)?.recoveryCodes ?? [];
    return Promise.resolve(codes.filter((code) => code.usedAt === null).length);
  }

  deleteFactor(userId: string): Promise<void> {
    this.factors.delete(userId);
    return Promise.resolve();
  }

  holdsAdministrativeRole(userId: string): Promise<boolean> {
    return Promise.resolve(this.administrativeUserIds.has(userId));
  }
}
