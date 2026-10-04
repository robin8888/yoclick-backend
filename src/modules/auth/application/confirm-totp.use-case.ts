import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '../../../shared/errors/domain-error';
import { HTTP_STATUS } from '../../../shared/errors/http-status';
import { MfaActivator } from './mfa-activator';
import {
  USER_ACCOUNT_REPOSITORY,
  type UserAccountRepository,
} from './ports/user-account.repository';
import { SecondFactorVerifier } from './second-factor-verifier';

export interface TotpConfirmation {
  /** Los códigos de recuperación, que se enseñan UNA sola vez: después solo existe su HMAC. */
  readonly recoveryCodes: readonly string[];
}

/** Termina de activar el segundo factor con el primer código de la app de autenticación. */
@Injectable()
export class ConfirmTotpUseCase {
  constructor(
    @Inject(USER_ACCOUNT_REPOSITORY) private readonly users: UserAccountRepository,
    private readonly secondFactorVerifier: SecondFactorVerifier,
    private readonly mfaActivator: MfaActivator,
  ) {}

  async execute(userId: string, code: string): Promise<TotpConfirmation> {
    const account = await this.users.findById(userId);
    if (!account) throw new DomainError('UNAUTHENTICATED', HTTP_STATUS.unauthorized);

    const step = await this.secondFactorVerifier.verifySetupCode({
      account,
      code,
      failureStatus: HTTP_STATUS.forbidden,
    });
    return { recoveryCodes: await this.mfaActivator.activate(account, step) };
  }
}
