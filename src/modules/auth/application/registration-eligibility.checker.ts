import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type Environment } from '../../../shared/config/environment.schema';
import { DomainError } from '../../../shared/errors/domain-error';
import { HTTP_STATUS } from '../../../shared/errors/http-status';
import { isDisposableEmail } from '../domain/disposable-email-domains';
import { PasswordAcceptabilityChecker } from './password-acceptability.checker';

export interface RegistrationCandidate {
  readonly email: string;
  readonly password: string;
  readonly consents: { readonly privacy: boolean; readonly terms: boolean };
}

/** Lo que debe cumplirse ANTES de crear una cuenta (y de gastar un hash de contraseña). */
@Injectable()
export class RegistrationEligibilityChecker {
  constructor(
    private readonly configService: ConfigService<Environment, true>,
    private readonly passwordAcceptabilityChecker: PasswordAcceptabilityChecker,
  ) {}

  async assertEligible(candidate: RegistrationCandidate): Promise<void> {
    if (!candidate.consents.privacy || !candidate.consents.terms) {
      throw new DomainError('CONSENT_REQUIRED', HTTP_STATUS.badRequest);
    }

    const areDisposableEmailsAllowed = this.configService.get('ALLOW_DISPOSABLE_EMAILS', {
      infer: true,
    });
    if (isDisposableEmail(candidate.email, { areDisposableEmailsAllowed })) {
      throw new DomainError('EMAIL_DOMAIN_NOT_ALLOWED', HTTP_STATUS.unprocessableEntity);
    }

    await this.passwordAcceptabilityChecker.assertAcceptable(candidate.password, candidate.email);
  }
}
