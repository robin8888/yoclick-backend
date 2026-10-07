import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '../../../shared/errors/domain-error';
import { HTTP_STATUS } from '../../../shared/errors/http-status';
import { canRecoverPassword } from '../../../shared/auth/unactivated-account';
import { AccountPasswordChanger } from './account-password-changer';
import { PasswordAcceptabilityChecker } from './password-acceptability.checker';
import {
  USER_ACCOUNT_REPOSITORY,
  type UserAccountRepository,
} from './ports/user-account.repository';
import { VerificationCodeChecker } from './verification-code-checker';

export interface ResetPasswordCommand {
  readonly email: string;
  readonly code: string;
  readonly newPassword: string;
}

/**
 * Cambia la contraseña con el código enviado al correo. Un correo desconocido o sin confirmar falla con
 * el mismo error que un código erróneo. La contraseña nueva se valida ANTES de consumir el código: si
 * es débil o está filtrada, el código sigue vivo y la persona puede elegir otra sin pedir uno nuevo.
 */
@Injectable()
export class ResetPasswordUseCase {
  constructor(
    @Inject(USER_ACCOUNT_REPOSITORY) private readonly users: UserAccountRepository,
    private readonly codeChecker: VerificationCodeChecker,
    private readonly passwordAcceptabilityChecker: PasswordAcceptabilityChecker,
    private readonly passwordChanger: AccountPasswordChanger,
  ) {}

  async execute(command: ResetPasswordCommand): Promise<void> {
    const account = await this.users.findByEmail(command.email);
    if (!account || !canRecoverPassword(account)) {
      throw new DomainError('VERIFICATION_CODE_INVALID', HTTP_STATUS.badRequest);
    }

    await this.codeChecker.verifyAndConsume({
      userId: account.id,
      purpose: 'password_reset',
      code: command.code,
      beforeConsuming: () =>
        this.passwordAcceptabilityChecker.assertAcceptable(
          command.newPassword,
          account.email,
          'newPassword',
        ),
    });
    await this.passwordChanger.change(account, command.newPassword);
  }
}
