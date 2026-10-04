import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '../../../shared/errors/domain-error';
import { HTTP_STATUS } from '../../../shared/errors/http-status';
import { type AuthenticatedLogin } from './login.use-case';
import {
  USER_ACCOUNT_REPOSITORY,
  type UserAccountRepository,
} from './ports/user-account.repository';
import { SecondFactorVerifier } from './second-factor-verifier';
import { SessionIssuer } from './session-issuer';

export interface VerifyMfaLoginCommand {
  /** El desafío que recibió la app al acertar la contraseña. */
  readonly mfaToken: string;
  readonly code?: string | undefined;
  readonly recoveryCode?: string | undefined;
  readonly deviceName: string | null;
}

/**
 * Completa el inicio de sesión de una cuenta con segundo factor: cambia el desafío y un código válido por
 * la sesión. La sesión queda marcada como verificada con segundo factor, que es lo que exigen las rutas de
 * administración, y esa marca se conserva en toda la familia de refresh tokens.
 */
@Injectable()
export class VerifyMfaLoginUseCase {
  constructor(
    @Inject(USER_ACCOUNT_REPOSITORY) private readonly users: UserAccountRepository,
    private readonly secondFactorVerifier: SecondFactorVerifier,
    private readonly sessionIssuer: SessionIssuer,
  ) {}

  async execute(command: VerifyMfaLoginCommand): Promise<AuthenticatedLogin> {
    const { userId } = await this.sessionIssuer.verifyMfaChallenge(command.mfaToken);
    const account = await this.users.findById(userId);
    if (!account) throw new DomainError('SESSION_INVALID', HTTP_STATUS.unauthorized);

    const now = new Date();
    if (account.lockedUntil !== null && account.lockedUntil > now) {
      throw new DomainError('MFA_CODE_INVALID', HTTP_STATUS.unauthorized);
    }

    await this.secondFactorVerifier.assertValid({
      account,
      code: command.code,
      recoveryCode: command.recoveryCode,
      failureStatus: HTTP_STATUS.unauthorized,
    });

    await this.users.recordSuccessfulLogin(account.id, now);
    const session = await this.sessionIssuer.startSession({
      userId: account.id,
      deviceName: command.deviceName,
      isMfaVerified: true,
    });
    return {
      kind: 'authenticated',
      ...session,
      user: { id: account.id, email: account.email, fullName: account.fullName },
    };
  }
}
