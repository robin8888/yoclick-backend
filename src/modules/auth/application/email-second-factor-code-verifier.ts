import { Injectable } from '@nestjs/common';
import { DomainError } from '../../../shared/errors/domain-error';
import { SecondFactorSecurityEvents } from './second-factor-security-events';
import { VerificationCodeChecker } from './verification-code-checker';

/**
 * Comprueba el código recibido por correo. Hasta 5 intentos por código, un solo uso y caducidad: lo
 * garantiza `VerificationCodeChecker`, que responde siempre igual ante cualquier fallo. Aquí solo se
 * traduce ese fallo a un booleano y se deja constancia del uso o del fallo.
 */
@Injectable()
export class EmailSecondFactorCodeVerifier {
  constructor(
    private readonly codeChecker: VerificationCodeChecker,
    private readonly securityEvents: SecondFactorSecurityEvents,
  ) {}

  async isValid(userId: string, code: string): Promise<boolean> {
    try {
      await this.codeChecker.verifyAndConsume({ userId, purpose: 'mfa_email', code });
    } catch (error) {
      if (error instanceof DomainError && error.code === 'VERIFICATION_CODE_INVALID') {
        this.securityEvents.record('mfa_email_code_failed', userId);
        return false;
      }
      throw error;
    }
    this.securityEvents.record('mfa_email_code_used', userId);
    return true;
  }
}
