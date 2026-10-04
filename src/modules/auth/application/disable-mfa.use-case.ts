import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '../../../shared/errors/domain-error';
import { HTTP_STATUS } from '../../../shared/errors/http-status';
import { AccountSecurityNotifier } from './account-security-notifier';
import { MFA_REPOSITORY, type MfaRepository } from './ports/mfa.repository';
import { SESSION_REPOSITORY, type SessionRepository } from './ports/session.repository';
import { ReauthenticationChecker } from './reauthentication.checker';
import { SecondFactorVerifier } from './second-factor-verifier';

export interface DisableMfaCommand {
  readonly userId: string;
  readonly password: string;
  readonly code?: string | undefined;
  readonly recoveryCode?: string | undefined;
}

/**
 * Desactiva el segundo factor. Pide la contraseña Y un código del propio segundo factor: quien solo
 * tuviera un token de acceso robado no puede quitarlo. Una propietaria o administradora no puede
 * desactivarlo (su rol lo exige). Cierra todas las sesiones y avisa por correo.
 */
@Injectable()
export class DisableMfaUseCase {
  constructor(
    private readonly reauthenticationChecker: ReauthenticationChecker,
    private readonly secondFactorVerifier: SecondFactorVerifier,
    @Inject(MFA_REPOSITORY) private readonly mfa: MfaRepository,
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepository,
    private readonly securityNotifier: AccountSecurityNotifier,
  ) {}

  async execute(command: DisableMfaCommand): Promise<void> {
    const account = await this.reauthenticationChecker.assertPasswordIsCorrect(
      command.userId,
      command.password,
    );

    const factor = await this.mfa.findFactor(command.userId);
    if (!factor?.isConfirmed) throw new DomainError('MFA_NOT_ENABLED', HTTP_STATUS.conflict);
    if (await this.mfa.holdsAdministrativeRole(command.userId)) {
      throw new DomainError('MFA_REQUIRED_FOR_ROLE', HTTP_STATUS.conflict);
    }

    await this.secondFactorVerifier.assertValid({
      account,
      code: command.code,
      recoveryCode: command.recoveryCode,
      failureStatus: HTTP_STATUS.forbidden,
    });

    await this.mfa.deleteFactor(command.userId);
    await this.sessions.revokeAllOfUser(command.userId, new Date());
    await this.securityNotifier.sendMfaChangedNotice(account, false);
  }
}
