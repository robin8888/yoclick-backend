import { Inject, Injectable } from '@nestjs/common';
import { PasswordHasher } from '../../../shared/auth/password-hasher';
import { DomainError } from '../../../shared/errors/domain-error';
import { HTTP_STATUS } from '../../../shared/errors/http-status';
import { LoginFailureRecorder } from './login-failure-recorder';
import { MFA_REPOSITORY, type MfaRepository } from './ports/mfa.repository';
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

export interface AuthenticatedLogin extends SessionTokens {
  readonly kind: 'authenticated';
  readonly user: { readonly id: string; readonly email: string; readonly fullName: string };
}

/** La contraseña era correcta pero la cuenta tiene segundo factor: falta el código. */
export interface MfaRequiredLogin {
  readonly kind: 'mfa_required';
  readonly mfaToken: string;
  readonly mfaTokenExpiresAt: Date;
}

export type LoginResult = AuthenticatedLogin | MfaRequiredLogin;

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
 *
 * Con segundo factor activado no se abre sesión todavía: se devuelve un desafío de 5 minutos que la app
 * cambia por la sesión al enviar el código (ver VerifyMfaLoginUseCase).
 */
@Injectable()
export class LoginUseCase {
  constructor(
    @Inject(USER_ACCOUNT_REPOSITORY) private readonly users: UserAccountRepository,
    private readonly passwordHasher: PasswordHasher,
    private readonly sessionIssuer: SessionIssuer,
    private readonly failureRecorder: LoginFailureRecorder,
    @Inject(MFA_REPOSITORY) private readonly mfa: MfaRepository,
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
      await this.failureRecorder.record(account);
      throw invalidCredentialsError();
    }

    if (account.emailVerifiedAt === null) {
      throw new DomainError('EMAIL_NOT_VERIFIED', HTTP_STATUS.forbidden);
    }

    if (await this.hasConfirmedSecondFactor(account.id)) {
      // El contador de fallos NO se reinicia todavía: la persona aún no ha completado el acceso. Tampoco
      // se recalcula el hash aquí; ocurrirá en el primer acceso sin segundo factor o al cambiarla.
      const challenge = await this.sessionIssuer.issueMfaChallenge(account.id);
      return {
        kind: 'mfa_required',
        mfaToken: challenge.token,
        mfaTokenExpiresAt: challenge.expiresAt,
      };
    }

    const upgradedHash = await this.upgradedHashFor(account, command.password);
    await this.users.recordSuccessfulLogin(account.id, now, upgradedHash);
    const session = await this.sessionIssuer.startSession({
      userId: account.id,
      deviceName: command.deviceName,
      isMfaVerified: false,
    });
    return {
      kind: 'authenticated',
      ...session,
      user: { id: account.id, email: account.email, fullName: account.fullName },
    };
  }

  private isLocked(account: UserAccount, now: Date): boolean {
    return account.lockedUntil !== null && account.lockedUntil > now;
  }

  private async hasConfirmedSecondFactor(userId: string): Promise<boolean> {
    const factor = await this.mfa.findFactor(userId);
    return factor?.isConfirmed ?? false;
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
