import { Inject, Injectable } from '@nestjs/common';
import { PasswordHasher } from '../../../shared/auth/password-hasher';
import { AccountSecurityNotifier } from './account-security-notifier';
import { SESSION_REPOSITORY, type SessionRepository } from './ports/session.repository';
import {
  USER_ACCOUNT_REPOSITORY,
  type UserAccount,
  type UserAccountRepository,
} from './ports/user-account.repository';

/**
 * Pone una contraseña nueva a una cuenta. Todo lo que debe ocurrir SIEMPRE que cambia una contraseña
 * está aquí, para que ningún camino se lo salte: se guarda el hash, se levanta el bloqueo, se cierran
 * todas las sesiones (quien tuviera la contraseña vieja o un token robado pierde el acceso) y se avisa
 * por correo a la persona.
 */
@Injectable()
export class AccountPasswordChanger {
  constructor(
    @Inject(USER_ACCOUNT_REPOSITORY) private readonly users: UserAccountRepository,
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepository,
    private readonly passwordHasher: PasswordHasher,
    private readonly securityNotifier: AccountSecurityNotifier,
  ) {}

  async change(account: UserAccount, newPlainPassword: string): Promise<void> {
    const now = new Date();
    const newPasswordHash = await this.passwordHasher.hash(newPlainPassword);

    await this.users.changePassword(account.id, newPasswordHash, now);
    await this.sessions.revokeAllOfUser(account.id, now);
    await this.securityNotifier.sendPasswordChangedNotice({
      email: account.email,
      fullName: account.fullName,
    });
  }
}
