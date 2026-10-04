import { Inject, Injectable } from '@nestjs/common';
import { PasswordHasher } from '../../../shared/auth/password-hasher';
import { DomainError } from '../../../shared/errors/domain-error';
import { HTTP_STATUS } from '../../../shared/errors/http-status';
import { MILLISECONDS_PER_MINUTE } from '../../../shared/time/time-units';
import { ACCOUNT_LOCK_DURATION_MINUTES, MAX_FAILED_LOGIN_ATTEMPTS } from '../domain/login-policy';
import { AccountSecurityNotifier } from './account-security-notifier';
import {
  USER_ACCOUNT_REPOSITORY,
  type UserAccount,
  type UserAccountRepository,
} from './ports/user-account.repository';
import { SessionIssuer, type SessionTokens } from './session-issuer';

export interface LoginCommand {
  readonly email: string;
  readonly password: string;
  readonly deviceName: string | null;
}

export interface LoginResult extends SessionTokens {
  readonly user: { readonly id: string; readonly email: string; readonly fullName: string };
}

function invalidCredentialsError(): DomainError {
  return new DomainError('INVALID_CREDENTIALS', HTTP_STATUS.unauthorized);
}

/**
 * Inicio de sesión. Defensas (SEC-46):
 * - Correo inexistente, contraseña errónea y cuenta bloqueada responden EXACTAMENTE igual.
 * - En el caso del correo inexistente y de la cuenta bloqueada se gasta el mismo tiempo de CPU que
 *   en una verificación real, de modo que el tiempo de respuesta no delata qué correos existen.
 * - Tras 10 fallos seguidos la cuenta se bloquea 15 minutos; el dueño recibe un correo.
 * - "Correo sin confirmar" solo se dice a quien ya demostró saber la contraseña.
 */
@Injectable()
export class LoginUseCase {
  constructor(
    @Inject(USER_ACCOUNT_REPOSITORY) private readonly users: UserAccountRepository,
    private readonly passwordHasher: PasswordHasher,
    private readonly sessionIssuer: SessionIssuer,
    private readonly securityNotifier: AccountSecurityNotifier,
  ) {}

  async execute(command: LoginCommand): Promise<LoginResult> {
    const account = await this.users.findByEmail(command.email);
    const now = new Date();

    if (!account || this.isLocked(account, now)) {
      await this.passwordHasher.spendTimeLikeAVerification(command.password);
      throw invalidCredentialsError();
    }

    const isPasswordCorrect = await this.passwordHasher.verify(
      account.passwordHash,
      command.password,
    );
    if (!isPasswordCorrect) {
      await this.registerFailure(account, now);
      throw invalidCredentialsError();
    }

    if (account.emailVerifiedAt === null) {
      throw new DomainError('EMAIL_NOT_VERIFIED', HTTP_STATUS.forbidden);
    }

    await this.users.recordSuccessfulLogin(
      account.id,
      now,
      await this.upgradedHashFor(account, command.password),
    );
    const session = await this.sessionIssuer.startSession({
      userId: account.id,
      deviceName: command.deviceName,
    });
    return {
      ...session,
      user: { id: account.id, email: account.email, fullName: account.fullName },
    };
  }

  private isLocked(account: UserAccount, now: Date): boolean {
    return account.lockedUntil !== null && account.lockedUntil > now;
  }

  private async registerFailure(account: UserAccount, now: Date): Promise<void> {
    const outcome = await this.users.recordFailedLogin(account.id, {
      maxFailedAttempts: MAX_FAILED_LOGIN_ATTEMPTS,
      lockDurationMs: ACCOUNT_LOCK_DURATION_MINUTES * MILLISECONDS_PER_MINUTE,
      now,
    });
    if (outcome.isNowLocked) {
      await this.securityNotifier.sendAccountLockedNotice({
        email: account.email,
        fullName: account.fullName,
      });
    }
  }

  /** Solo aquí se tiene la contraseña en claro: es el momento de recalcular un hash con parámetros antiguos. */
  private async upgradedHashFor(
    account: UserAccount,
    password: string,
  ): Promise<string | undefined> {
    return this.passwordHasher.needsRehash(account.passwordHash)
      ? this.passwordHasher.hash(password)
      : undefined;
  }
}
