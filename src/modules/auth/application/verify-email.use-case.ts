import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '../../../shared/errors/domain-error';
import { HTTP_STATUS } from '../../../shared/errors/http-status';
import { MAX_VERIFICATION_ATTEMPTS } from '../domain/verification-code';
import {
  VERIFICATION_CODE_HASHER,
  type VerificationCodeHasher,
} from './ports/verification-code.hasher';
import {
  USER_ACCOUNT_REPOSITORY,
  type UserAccountRepository,
} from './ports/user-account.repository';
import {
  VERIFICATION_CODE_REPOSITORY,
  type VerificationCodeRepository,
} from './ports/verification-code.repository';

export interface VerifyEmailCommand {
  readonly email: string;
  readonly code: string;
}

function invalidCodeError(): DomainError {
  return new DomainError('VERIFICATION_CODE_INVALID', HTTP_STATUS.badRequest);
}

/**
 * Confirma el correo con el código de 6 dígitos.
 *
 * Todos los fallos (correo desconocido, cuenta ya verificada, código erróneo, caducado, agotado o ya
 * usado) devuelven EL MISMO error: así no se puede averiguar qué correos tienen cuenta (SEC-46).
 * El intento se cuenta ANTES de comparar y de forma atómica, de modo que no hay carrera que permita
 * pasar de los 5 intentos.
 */
@Injectable()
export class VerifyEmailUseCase {
  constructor(
    @Inject(USER_ACCOUNT_REPOSITORY) private readonly users: UserAccountRepository,
    @Inject(VERIFICATION_CODE_REPOSITORY) private readonly codes: VerificationCodeRepository,
    @Inject(VERIFICATION_CODE_HASHER) private readonly codeHasher: VerificationCodeHasher,
  ) {}

  async execute(command: VerifyEmailCommand): Promise<void> {
    const account = await this.users.findByEmail(command.email);
    if (!account || account.emailVerifiedAt !== null) throw invalidCodeError();

    const now = new Date();
    const activeCode = await this.codes.findActiveCode(account.id, 'email_verification', now);
    if (!activeCode) throw invalidCodeError();

    const reference = { userId: account.id, codeId: activeCode.id };
    const attemptNumber = await this.codes.registerAttempt(reference);
    if (attemptNumber > MAX_VERIFICATION_ATTEMPTS) throw invalidCodeError();
    if (!this.codeHasher.matches(command.code, activeCode.codeHash)) throw invalidCodeError();

    // Un solo uso: si dos peticiones llegan a la vez con el código bueno, solo una lo consume.
    const wasConsumed = await this.codes.consume(reference, now);
    if (!wasConsumed) throw invalidCodeError();

    await this.users.markEmailVerified(account.id, now);
  }
}
