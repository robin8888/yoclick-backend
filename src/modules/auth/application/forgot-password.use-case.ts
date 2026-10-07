import { Inject, Injectable } from '@nestjs/common';
import { canRecoverPassword } from '../../../shared/auth/unactivated-account';
import {
  USER_ACCOUNT_REPOSITORY,
  type UserAccountRepository,
} from './ports/user-account.repository';
import { VerificationCodeIssuer } from './verification-code-issuer';

export interface ForgotPasswordCommand {
  readonly email: string;
}

/**
 * Envía un código para cambiar la contraseña. No dice nunca si el correo existe: para uno desconocido
 * o con el correo sin confirmar (salvo una cuenta importada sin activar) no hace nada, y la respuesta HTTP es la misma (SEC-46).
 */
@Injectable()
export class ForgotPasswordUseCase {
  constructor(
    @Inject(USER_ACCOUNT_REPOSITORY) private readonly users: UserAccountRepository,
    private readonly codeIssuer: VerificationCodeIssuer,
  ) {}

  async execute(command: ForgotPasswordCommand): Promise<void> {
    const account = await this.users.findByEmail(command.email);
    // Las cuentas que un centro creó al importar no tienen contraseña: así la fijan por primera vez.
    if (!account || !canRecoverPassword(account)) return;

    await this.codeIssuer.issue(
      { userId: account.id, email: account.email, fullName: account.fullName },
      'password_reset',
    );
  }
}
