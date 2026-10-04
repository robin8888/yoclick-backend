import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '../../../shared/errors/domain-error';
import { HTTP_STATUS } from '../../../shared/errors/http-status';
import {
  USER_ACCOUNT_REPOSITORY,
  type UserAccountRepository,
} from './ports/user-account.repository';
import { VerificationCodeChecker } from './verification-code-checker';

export interface VerifyEmailCommand {
  readonly email: string;
  readonly code: string;
}

/**
 * Confirma el correo con el código de 6 dígitos. Un correo desconocido o ya verificado falla con el
 * mismo error que un código erróneo: no se puede averiguar qué correos tienen cuenta (SEC-46).
 */
@Injectable()
export class VerifyEmailUseCase {
  constructor(
    @Inject(USER_ACCOUNT_REPOSITORY) private readonly users: UserAccountRepository,
    private readonly codeChecker: VerificationCodeChecker,
  ) {}

  async execute(command: VerifyEmailCommand): Promise<void> {
    const account = await this.users.findByEmail(command.email);
    if (!account || account.emailVerifiedAt !== null) {
      throw new DomainError('VERIFICATION_CODE_INVALID', HTTP_STATUS.badRequest);
    }

    await this.codeChecker.verifyAndConsume({
      userId: account.id,
      purpose: 'email_verification',
      code: command.code,
    });
    await this.users.markEmailVerified(account.id, new Date());
  }
}
