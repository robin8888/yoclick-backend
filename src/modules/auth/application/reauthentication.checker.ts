import { Inject, Injectable } from '@nestjs/common';
import { PasswordHasher } from '../../../shared/auth/password-hasher';
import { DomainError } from '../../../shared/errors/domain-error';
import { HTTP_STATUS } from '../../../shared/errors/http-status';
import { LoginFailureRecorder } from './login-failure-recorder';
import {
  USER_ACCOUNT_REPOSITORY,
  type UserAccount,
  type UserAccountRepository,
} from './ports/user-account.repository';

function reauthenticationFailedError(): DomainError {
  return new DomainError('REAUTHENTICATION_FAILED', HTTP_STATUS.forbidden);
}

/**
 * Vuelve a pedir la contraseña antes de una acción delicada: cambiarla, exportar los datos, eliminar la
 * cuenta (SEC-12). Un token de acceso robado no basta para ninguna de ellas.
 *
 * Los fallos cuentan para el mismo bloqueo que el inicio de sesión: si no, esta ruta sería una forma de
 * adivinar contraseñas esquivando el límite. Responde 403 y no 401: la app trata un 401 como "sesión
 * caducada" e intentaría renovarla, que no es lo que ha pasado aquí.
 */
@Injectable()
export class ReauthenticationChecker {
  constructor(
    @Inject(USER_ACCOUNT_REPOSITORY) private readonly users: UserAccountRepository,
    private readonly passwordHasher: PasswordHasher,
    private readonly failureRecorder: LoginFailureRecorder,
  ) {}

  async assertPasswordIsCorrect(userId: string, plainPassword: string): Promise<UserAccount> {
    const account = await this.users.findById(userId);
    if (!account) throw new DomainError('UNAUTHENTICATED', HTTP_STATUS.unauthorized);

    const now = new Date();
    if (account.lockedUntil !== null && account.lockedUntil > now) {
      await this.passwordHasher.spendTimeLikeAVerification(plainPassword);
      throw reauthenticationFailedError();
    }

    const isPasswordCorrect = await this.passwordHasher.verify(account.passwordHash, plainPassword);
    if (!isPasswordCorrect) {
      await this.failureRecorder.record(account);
      throw reauthenticationFailedError();
    }

    await this.users.recordSuccessfulLogin(account.id, now);
    return account;
  }
}
