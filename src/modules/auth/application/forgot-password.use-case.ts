import { Inject, Injectable } from '@nestjs/common';
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
 * o con el correo sin confirmar no hace nada, y la respuesta HTTP es la misma (SEC-46).
 */
@Injectable()
export class ForgotPasswordUseCase {
  constructor(
    @Inject(USER_ACCOUNT_REPOSITORY) private readonly users: UserAccountRepository,
    private readonly codeIssuer: VerificationCodeIssuer,
  ) {}

  async execute(command: ForgotPasswordCommand): Promise<void> {
    const account = await this.users.findByEmail(command.email);
    if (!account || account.emailVerifiedAt === null) return;

    await this.codeIssuer.issue(
      { userId: account.id, email: account.email, fullName: account.fullName },
      'password_reset',
    );
  }
}
