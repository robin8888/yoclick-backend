import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '../../../shared/errors/domain-error';
import { HTTP_STATUS } from '../../../shared/errors/http-status';
import { SecretEncryptor } from '../../../shared/crypto/secret-encryptor';
import { TotpEngine } from '../infrastructure/totp-engine';
import { LoginFailureRecorder } from './login-failure-recorder';
import { MFA_REPOSITORY, type MfaRepository } from './ports/mfa.repository';
import { type UserAccount } from './ports/user-account.repository';
import { RecoveryCodeService } from './recovery-code-service';

export interface SecondFactorAttempt {
  readonly account: UserAccount;
  /** Código de 6 dígitos de la app de autenticación. */
  readonly code?: string | undefined;
  /** Código de recuperación de un solo uso, si se perdió el dispositivo. */
  readonly recoveryCode?: string | undefined;
  /** 401 al iniciar sesión (aún sin sesión); 403 con la sesión iniciada (un 401 haría que la app intente renovarla). */
  readonly failureStatus: number;
}

/**
 * Comprueba un código del segundo factor, de la app (TOTP) o de recuperación. Es lo único que decide si
 * un código vale:
 *
 * - El TOTP solo se acepta si su intervalo es posterior al último usado, de forma atómica: un código
 *   espiado por encima del hombro no se puede reutilizar, ni siquiera dentro de sus 30 segundos.
 * - Un código de recuperación se gasta al usarlo.
 * - Cada fallo cuenta para el mismo bloqueo que la contraseña (tres vías, un solo contador).
 */
@Injectable()
export class SecondFactorVerifier {
  constructor(
    @Inject(MFA_REPOSITORY) private readonly mfa: MfaRepository,
    private readonly totpEngine: TotpEngine,
    private readonly secretEncryptor: SecretEncryptor,
    private readonly recoveryCodeService: RecoveryCodeService,
    private readonly failureRecorder: LoginFailureRecorder,
  ) {}

  /**
   * El primer código de la app, al activar el segundo factor: se comprueba contra el secreto aún SIN
   * confirmar y devuelve el intervalo, que `confirmFactor` deja anotado como ya usado.
   */
  async verifySetupCode(attempt: {
    readonly account: UserAccount;
    readonly code: string;
    readonly failureStatus: number;
  }): Promise<number> {
    const factor = await this.mfa.findFactor(attempt.account.id);
    if (!factor || factor.isConfirmed) {
      throw new DomainError('MFA_NOT_ENABLED', HTTP_STATUS.conflict);
    }

    const step = this.totpEngine.findMatchingStep(
      this.secretEncryptor.decrypt(factor.encryptedSecret),
      attempt.code,
      new Date(),
    );
    if (step === null) {
      await this.failureRecorder.record(attempt.account);
      throw new DomainError('MFA_CODE_INVALID', attempt.failureStatus);
    }
    return step;
  }

  async assertValid(attempt: SecondFactorAttempt): Promise<void> {
    const isValid = await this.isValid(attempt);
    if (isValid) return;

    await this.failureRecorder.record(attempt.account);
    throw new DomainError('MFA_CODE_INVALID', attempt.failureStatus);
  }

  private async isValid(attempt: SecondFactorAttempt): Promise<boolean> {
    const factor = await this.mfa.findFactor(attempt.account.id);
    if (!factor?.isConfirmed) return false;

    if (attempt.code !== undefined) {
      return this.isTotpValid(attempt.account.id, factor.encryptedSecret, attempt.code);
    }
    if (attempt.recoveryCode !== undefined) {
      return this.mfa.consumeRecoveryCode(
        attempt.account.id,
        this.recoveryCodeService.hashTypedCode(attempt.recoveryCode),
        new Date(),
      );
    }
    return false;
  }

  private async isTotpValid(
    userId: string,
    encryptedSecret: string,
    code: string,
  ): Promise<boolean> {
    const secret = this.secretEncryptor.decrypt(encryptedSecret);
    const step = this.totpEngine.findMatchingStep(secret, code, new Date());
    return step !== null && (await this.mfa.markStepUsed(userId, step));
  }
}
