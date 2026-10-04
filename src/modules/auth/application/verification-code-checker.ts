import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '../../../shared/errors/domain-error';
import { HTTP_STATUS } from '../../../shared/errors/http-status';
import { MAX_VERIFICATION_ATTEMPTS } from '../domain/verification-code';
import {
  VERIFICATION_CODE_HASHER,
  type VerificationCodeHasher,
} from './ports/verification-code.hasher';
import {
  VERIFICATION_CODE_REPOSITORY,
  type VerificationCodeRepository,
  type VerificationPurposeName,
} from './ports/verification-code.repository';

export interface CodeSubmission {
  readonly userId: string;
  readonly purpose: VerificationPurposeName;
  readonly code: string;
  /**
   * Se ejecuta con el código ya comprobado y ANTES de consumirlo. Si lanza, el código sigue vivo:
   * una contraseña nueva rechazada por débil no gasta el código de recuperación.
   */
  readonly beforeConsuming?: () => Promise<void>;
}

function invalidCodeError(): DomainError {
  return new DomainError('VERIFICATION_CODE_INVALID', HTTP_STATUS.badRequest);
}

/**
 * Comprueba un código de 6 dígitos y lo consume. Compartido por verificar el correo y recuperar la
 * contraseña, para que las dos reglas de seguridad sean idénticas:
 *
 * - El intento se cuenta ANTES de comparar y de forma atómica: no hay carrera que pase de los 5.
 * - Un solo uso: si dos peticiones llegan a la vez con el código bueno, solo una lo consume.
 * - Todos los fallos (sin código vigente, caducado, agotado, erróneo, ya usado) lanzan EL MISMO
 *   error, para que nadie pueda saber por qué falló.
 */
@Injectable()
export class VerificationCodeChecker {
  constructor(
    @Inject(VERIFICATION_CODE_REPOSITORY) private readonly codes: VerificationCodeRepository,
    @Inject(VERIFICATION_CODE_HASHER) private readonly codeHasher: VerificationCodeHasher,
  ) {}

  async verifyAndConsume(submission: CodeSubmission): Promise<void> {
    const now = new Date();
    const activeCode = await this.codes.findActiveCode(submission.userId, submission.purpose, now);
    if (!activeCode) throw invalidCodeError();

    const reference = { userId: submission.userId, codeId: activeCode.id };
    const attemptNumber = await this.codes.registerAttempt(reference);
    if (attemptNumber > MAX_VERIFICATION_ATTEMPTS) throw invalidCodeError();
    if (!this.codeHasher.matches(submission.code, activeCode.codeHash)) throw invalidCodeError();

    await submission.beforeConsuming?.();

    const wasConsumed = await this.codes.consume(reference, now);
    if (!wasConsumed) throw invalidCodeError();
  }
}
