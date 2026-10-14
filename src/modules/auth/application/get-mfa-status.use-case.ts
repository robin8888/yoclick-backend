import { Inject, Injectable } from '@nestjs/common';
import { maskEmailAddress, type SecondFactorMethod } from '../domain/email-second-factor';
import { MFA_REPOSITORY, type MfaRepository } from './ports/mfa.repository';
import {
  USER_ACCOUNT_REPOSITORY,
  type UserAccountRepository,
} from './ports/user-account.repository';

export interface MfaStatus {
  readonly isEnabled: boolean;
  /** El método principal activo, o `null` si no hay segundo factor. */
  readonly method: SecondFactorMethod | null;
  /** El correo enmascarado al que llegarían los códigos por email (a***@dominio). */
  readonly emailHint: string | null;
  /** Cuántos códigos de recuperación quedan sin usar, para avisar de que genere otros antes de quedarse sin ninguno. */
  readonly recoveryCodesRemaining: number;
}

@Injectable()
export class GetMfaStatusUseCase {
  constructor(
    @Inject(MFA_REPOSITORY) private readonly mfa: MfaRepository,
    @Inject(USER_ACCOUNT_REPOSITORY) private readonly users: UserAccountRepository,
  ) {}

  async execute(userId: string): Promise<MfaStatus> {
    const factor = await this.mfa.findFactor(userId);
    const account = await this.users.findById(userId);
    const isEnabled = factor?.isConfirmed ?? false;
    return {
      isEnabled,
      method: isEnabled && factor ? factor.method : null,
      emailHint: account ? maskEmailAddress(account.email) : null,
      recoveryCodesRemaining: isEnabled ? await this.mfa.countUnusedRecoveryCodes(userId) : 0,
    };
  }
}
