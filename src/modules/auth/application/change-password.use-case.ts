import { Injectable } from '@nestjs/common';
import { DomainError } from '../../../shared/errors/domain-error';
import { HTTP_STATUS } from '../../../shared/errors/http-status';
import { AccountPasswordChanger } from './account-password-changer';
import { PasswordAcceptabilityChecker } from './password-acceptability.checker';
import { ReauthenticationChecker } from './reauthentication.checker';

export interface ChangePasswordCommand {
  readonly userId: string;
  readonly currentPassword: string;
  readonly newPassword: string;
}

/**
 * Cambio de contraseña con la sesión iniciada. Pide la actual (SEC-12) y, como en la recuperación,
 * cierra todas las sesiones, la actual incluida: la app tiene que volver a iniciar sesión.
 */
@Injectable()
export class ChangePasswordUseCase {
  constructor(
    private readonly reauthenticationChecker: ReauthenticationChecker,
    private readonly passwordAcceptabilityChecker: PasswordAcceptabilityChecker,
    private readonly passwordChanger: AccountPasswordChanger,
  ) {}

  async execute(command: ChangePasswordCommand): Promise<void> {
    const account = await this.reauthenticationChecker.assertPasswordIsCorrect(
      command.userId,
      command.currentPassword,
    );

    if (command.newPassword === command.currentPassword) {
      throw new DomainError('VALIDATION_FAILED', HTTP_STATUS.badRequest, [
        { path: 'newPassword', code: 'same_as_current' },
      ]);
    }
    await this.passwordAcceptabilityChecker.assertAcceptable(
      command.newPassword,
      account.email,
      'newPassword',
    );
    await this.passwordChanger.change(account, command.newPassword);
  }
}
