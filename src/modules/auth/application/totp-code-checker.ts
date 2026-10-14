import { Injectable } from '@nestjs/common';
import { SecretEncryptor } from '../../../shared/crypto/secret-encryptor';
import { TotpEngine } from '../infrastructure/totp-engine';

/** Descifra el secreto guardado y busca el intervalo de 30 s al que corresponde un código de la app. */
@Injectable()
export class TotpCodeChecker {
  constructor(
    private readonly totpEngine: TotpEngine,
    private readonly secretEncryptor: SecretEncryptor,
  ) {}

  /** El intervalo que casa con el código (con la tolerancia del motor), o `null` si no casa. */
  findMatchingStep(encryptedSecret: string, code: string): number | null {
    const secret = this.secretEncryptor.decrypt(encryptedSecret);
    return this.totpEngine.findMatchingStep(secret, code, new Date());
  }
}
