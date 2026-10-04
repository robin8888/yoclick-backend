import { Injectable } from '@nestjs/common';
import * as OTPAuth from 'otpauth';
import { MILLISECONDS_PER_SECOND } from '../../../shared/time/time-units';

const ISSUER = 'Yoclick';
const SECRET_BYTES = 20;
const DIGITS = 6;
const PERIOD_SECONDS = 30;
/** Un intervalo de 30 s hacia cada lado absorbe el desfase de reloj del móvil sin abrir la ventana de más. */
const CLOCK_DRIFT_WINDOW_STEPS = 1;

interface ProvisioningDetails {
  readonly secret: string;
  readonly accountName: string;
}

/**
 * TOTP (RFC 6238) con SHA-1, 6 dígitos y 30 s: lo que entienden Google Authenticator, Authy, 1Password,
 * Microsoft Authenticator y la app de contraseñas de iOS. Usa la librería `otpauth`, sin criptografía propia.
 */
@Injectable()
export class TotpEngine {
  generateSecret(): string {
    return new OTPAuth.Secret({ size: SECRET_BYTES }).base32;
  }

  /** El URI `otpauth://` que se muestra como QR o se pega en la app de autenticación. */
  buildProvisioningUri(details: ProvisioningDetails): string {
    return this.buildTotp(details.secret, details.accountName).toString();
  }

  /**
   * El intervalo de tiempo al que corresponde el código, o `null` si no es válido. Devolver el intervalo
   * (y no un booleano) permite al llamante impedir que el mismo código se use dos veces.
   */
  findMatchingStep(secret: string, code: string, now: Date): number | null {
    if (!/^\d{6}$/.test(code)) return null;

    const driftInSteps = this.buildTotp(secret, 'verification').validate({
      token: code,
      timestamp: now.getTime(),
      window: CLOCK_DRIFT_WINDOW_STEPS,
    });
    if (driftInSteps === null) return null;

    const currentStep = Math.floor(now.getTime() / (PERIOD_SECONDS * MILLISECONDS_PER_SECOND));
    return currentStep + driftInSteps;
  }

  private buildTotp(base32Secret: string, label: string): OTPAuth.TOTP {
    return new OTPAuth.TOTP({
      issuer: ISSUER,
      label,
      algorithm: 'SHA1',
      digits: DIGITS,
      period: PERIOD_SECONDS,
      secret: OTPAuth.Secret.fromBase32(base32Secret),
    });
  }
}
