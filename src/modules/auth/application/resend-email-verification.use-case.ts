import { Inject, Injectable } from '@nestjs/common';
import {
  USER_ACCOUNT_REPOSITORY,
  type UserAccountRepository,
} from './ports/user-account.repository';
import { VerificationCodeIssuer } from './verification-code-issuer';

export interface ResendEmailVerificationCommand {
  readonly email: string;
}

/**
 * Reenvía el código de verificación. No dice nunca si el correo existe: para uno desconocido o ya
 * verificado simplemente no hace nada, y la respuesta HTTP es la misma.
 */
@Injectable()
export class ResendEmailVerificationUseCase {
  constructor(
    @Inject(USER_ACCOUNT_REPOSITORY) private readonly users: UserAccountRepository,
    private readonly codeIssuer: VerificationCodeIssuer,
  ) {}

  async execute(command: ResendEmailVerificationCommand): Promise<void> {
    const account = await this.users.findByEmail(command.email);
    if (!account || account.emailVerifiedAt !== null) return;

    await this.codeIssuer.issue(
      { userId: account.id, email: account.email, fullName: account.fullName },
      'email_verification',
    );
  }
}
