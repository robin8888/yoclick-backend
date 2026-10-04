import { Inject, Injectable } from '@nestjs/common';
import { MFA_REPOSITORY, type MfaRepository } from './ports/mfa.repository';

export interface MfaStatus {
  readonly isEnabled: boolean;
  /** Cuántos códigos de recuperación quedan sin usar, para avisar de que genere otros antes de quedarse sin ninguno. */
  readonly recoveryCodesRemaining: number;
}

@Injectable()
export class GetMfaStatusUseCase {
  constructor(@Inject(MFA_REPOSITORY) private readonly mfa: MfaRepository) {}

  async execute(userId: string): Promise<MfaStatus> {
    const factor = await this.mfa.findFactor(userId);
    const isEnabled = factor?.isConfirmed ?? false;
    return {
      isEnabled,
      recoveryCodesRemaining: isEnabled ? await this.mfa.countUnusedRecoveryCodes(userId) : 0,
    };
  }
}
