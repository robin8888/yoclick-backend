import { type BreachedPasswordChecker } from '../../src/modules/auth/application/ports/breached-password.checker';
import {
  type CreateUserAccountResult,
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
      consents: newUser.consents,
    });
    return Promise.resolve('created');
  }

  markEmailVerified(userId: string, verifiedAt: Date): Promise<void> {
    for (const [key, account] of this.accounts) {
      if (account.id === userId)
        this.accounts.set(key, { ...account, emailVerifiedAt: verifiedAt });
    }
    return Promise.resolve();
  }

  seedAccount(account: UserAccount): void {
    this.accounts.set(account.email.toLowerCase(), { ...account, consents: [] });
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
