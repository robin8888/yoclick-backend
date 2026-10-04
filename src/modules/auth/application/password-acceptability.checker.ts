import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '../../../shared/errors/domain-error';
import { HTTP_STATUS } from '../../../shared/errors/http-status';
import { findPasswordPolicyViolations } from '../domain/password-policy';
import {
  BREACHED_PASSWORD_CHECKER,
  type BreachedPasswordChecker,
} from './ports/breached-password.checker';

/** ¿Vale esta contraseña para una cuenta? Longitud, no contener el correo y no estar filtrada (SEC-43). */
@Injectable()
export class PasswordAcceptabilityChecker {
  constructor(
    @Inject(BREACHED_PASSWORD_CHECKER)
    private readonly breachedPasswordChecker: BreachedPasswordChecker,
  ) {}

  async assertAcceptable(plainPassword: string, email: string): Promise<void> {
    const violations = findPasswordPolicyViolations(plainPassword, email);
    if (violations.length > 0) {
      throw new DomainError(
        'VALIDATION_FAILED',
        HTTP_STATUS.badRequest,
        violations.map((violation) => ({ path: 'password', code: violation })),
      );
    }

    if (await this.breachedPasswordChecker.isBreached(plainPassword)) {
      throw new DomainError('PASSWORD_BREACHED', HTTP_STATUS.unprocessableEntity, [
        { path: 'password', code: 'breached' },
      ]);
    }
  }
}
