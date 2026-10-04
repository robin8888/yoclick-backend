import { Inject, Injectable } from '@nestjs/common';
import { generateRecoveryCodes, normalizeRecoveryCode } from '../domain/recovery-code';
import {
  VERIFICATION_CODE_HASHER,
  type VerificationCodeHasher,
} from './ports/verification-code.hasher';

export interface GeneratedRecoveryCodes {
  /** Lo que se enseña a la persona UNA vez. */
  readonly plainCodes: readonly string[];
  /** Lo único que se guarda. */
  readonly hashes: readonly string[];
}

/**
 * Crea los códigos de recuperación y los convierte en lo que se guarda. Se firman con el mismo HMAC con
 * pepper que los códigos de correo: sin el pepper, una base de datos robada no revela ninguno.
 */
@Injectable()
export class RecoveryCodeService {
  constructor(
    @Inject(VERIFICATION_CODE_HASHER) private readonly codeHasher: VerificationCodeHasher,
  ) {}

  generate(): GeneratedRecoveryCodes {
    const plainCodes = generateRecoveryCodes();
    return { plainCodes, hashes: plainCodes.map((code) => this.hashTypedCode(code)) };
  }

  /** Acepta el código con o sin guion, en mayúsculas o minúsculas. */
  hashTypedCode(typedCode: string): string {
    return this.codeHasher.hash(normalizeRecoveryCode(typedCode));
  }
}
