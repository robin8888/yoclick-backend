import { Inject, Injectable } from '@nestjs/common';
import { HTTP_STATUS } from '../../../shared/errors/http-status';
import { MFA_REPOSITORY, type MfaRepository } from './ports/mfa.repository';
import { ReauthenticationChecker } from './reauthentication.checker';
import { RecoveryCodeService } from './recovery-code-service';
import { SecondFactorVerifier } from './second-factor-verifier';

export interface RegenerateRecoveryCodesCommand {
  readonly userId: string;
  readonly password: string;
  readonly code?: string | undefined;
  readonly recoveryCode?: string | undefined;
}

/** Sustituye los códigos de recuperación por otros diez nuevos; los anteriores dejan de valer. */
@Injectable()
export class RegenerateRecoveryCodesUseCase {
  constructor(
    private readonly reauthenticationChecker: ReauthenticationChecker,
    private readonly secondFactorVerifier: SecondFactorVerifier,
    private readonly recoveryCodeService: RecoveryCodeService,
    @Inject(MFA_REPOSITORY) private readonly mfa: MfaRepository,
  ) {}

  async execute(command: RegenerateRecoveryCodesCommand): Promise<readonly string[]> {
    const account = await this.reauthenticationChecker.assertPasswordIsCorrect(
      command.userId,
      command.password,
    );
    await this.secondFactorVerifier.assertValid({
      account,
      code: command.code,
      recoveryCode: command.recoveryCode,
      failureStatus: HTTP_STATUS.forbidden,
    });

    const recovery = this.recoveryCodeService.generate();
    await this.mfa.replaceRecoveryCodes(command.userId, recovery.hashes);
    return recovery.plainCodes;
  }
}
