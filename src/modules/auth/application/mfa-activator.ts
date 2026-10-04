import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '../../../shared/errors/domain-error';
import { HTTP_STATUS } from '../../../shared/errors/http-status';
import { AccountSecurityNotifier } from './account-security-notifier';
import { MFA_REPOSITORY, type MfaRepository } from './ports/mfa.repository';
import { type UserAccount } from './ports/user-account.repository';
import { RecoveryCodeService } from './recovery-code-service';

/**
 * Activa el segundo factor ya comprobado: confirma el factor, genera y guarda los códigos de recuperación
 * y avisa por correo. Devuelve los códigos en claro, que se enseñan UNA sola vez: después solo existe su HMAC.
 */
@Injectable()
export class MfaActivator {
  constructor(
    @Inject(MFA_REPOSITORY) private readonly mfa: MfaRepository,
    private readonly recoveryCodeService: RecoveryCodeService,
    private readonly securityNotifier: AccountSecurityNotifier,
  ) {}

  async activate(account: UserAccount, confirmedStep: number): Promise<readonly string[]> {
    const recovery = this.recoveryCodeService.generate();
    const wasConfirmed = await this.mfa.confirmFactor(account.id, {
      step: confirmedStep,
      recoveryCodeHashes: recovery.hashes,
    });
    if (!wasConfirmed) throw new DomainError('MFA_NOT_ENABLED', HTTP_STATUS.conflict);

    await this.securityNotifier.sendMfaChangedNotice(account, true);
    return recovery.plainCodes;
  }
}
