import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '../../../shared/errors/domain-error';
import { HTTP_STATUS } from '../../../shared/errors/http-status';
import { type TotpConfirmation } from './confirm-totp.use-case';
import { MfaActivator } from './mfa-activator';
import {
  USER_ACCOUNT_REPOSITORY,
  type UserAccountRepository,
} from './ports/user-account.repository';
import { SecondFactorVerifier } from './second-factor-verifier';
import { SessionIssuer } from './session-issuer';

/** Termina de activar el segundo factor por correo con el código recibido y entrega los de recuperación. */
@Injectable()
export class ConfirmEmailMfaUseCase {
  constructor(
    @Inject(USER_ACCOUNT_REPOSITORY) private readonly users: UserAccountRepository,
    private readonly secondFactorVerifier: SecondFactorVerifier,
    private readonly mfaActivator: MfaActivator,
    private readonly sessionIssuer: SessionIssuer,
  ) {}

  async execute(userId: string, code: string): Promise<TotpConfirmation> {
    const account = await this.users.findById(userId);
    if (!account) throw new DomainError('UNAUTHENTICATED', HTTP_STATUS.unauthorized);

    await this.secondFactorVerifier.verifyEmailSetupCode({
      account,
      code,
      failureStatus: HTTP_STATUS.forbidden,
    });
    const recoveryCodes = await this.mfaActivator.activate(account, null);
    const session = await this.sessionIssuer.startSession({
      userId,
      deviceName: null,
      isMfaVerified: true,
    });
    return { recoveryCodes, session };
  }
}
