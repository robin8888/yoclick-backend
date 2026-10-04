import { Inject, Injectable } from '@nestjs/common';
import { MILLISECONDS_PER_MINUTE } from '../../../shared/time/time-units';
import { ACCOUNT_LOCK_DURATION_MINUTES, MAX_FAILED_LOGIN_ATTEMPTS } from '../domain/login-policy';
import { AccountSecurityNotifier } from './account-security-notifier';
import {
  USER_ACCOUNT_REPOSITORY,
  type UserAccount,
  type UserAccountRepository,
} from './ports/user-account.repository';

/**
 * Anota un intento fallido de demostrar quién eres (contraseña o segundo factor) y, al llegar al límite,
 * bloquea la cuenta y avisa a su dueña por correo. Es UN solo contador para el login, la reautenticación
 * y el segundo factor: si cada uno llevara el suyo, un atacante tendría el triple de intentos.
 */
@Injectable()
export class LoginFailureRecorder {
  constructor(
    @Inject(USER_ACCOUNT_REPOSITORY) private readonly users: UserAccountRepository,
    private readonly securityNotifier: AccountSecurityNotifier,
  ) {}

  async record(account: UserAccount): Promise<void> {
    const outcome = await this.users.recordFailedLogin(account.id, {
      maxFailedAttempts: MAX_FAILED_LOGIN_ATTEMPTS,
      lockDurationMs: ACCOUNT_LOCK_DURATION_MINUTES * MILLISECONDS_PER_MINUTE,
      now: new Date(),
    });
    if (outcome.isNowLocked) {
      await this.securityNotifier.sendAccountLockedNotice({
        email: account.email,
        fullName: account.fullName,
      });
    }
  }
}
