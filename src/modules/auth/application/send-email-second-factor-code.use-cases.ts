import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '../../../shared/errors/domain-error';
import { HTTP_STATUS } from '../../../shared/errors/http-status';
import { EmailSecondFactorCodeIssuer } from './email-second-factor-code-issuer';
import { MFA_REPOSITORY, type MfaRepository } from './ports/mfa.repository';
import {
  USER_ACCOUNT_REPOSITORY,
  type UserAccountRepository,
} from './ports/user-account.repository';
import { SessionIssuer } from './session-issuer';

export interface EmailCodeSent {
  readonly emailHint: string;
  readonly codeExpiresAt: Date;
}

/** Quien está iniciando sesión (ya acertó la contraseña) pide el código por correo en vez de usar su app. */
@Injectable()
export class SendLoginEmailCodeUseCase {
  constructor(
    @Inject(USER_ACCOUNT_REPOSITORY) private readonly users: UserAccountRepository,
    @Inject(MFA_REPOSITORY) private readonly mfa: MfaRepository,
    private readonly sessionIssuer: SessionIssuer,
    private readonly codeIssuer: EmailSecondFactorCodeIssuer,
  ) {}

  async execute(mfaToken: string): Promise<EmailCodeSent> {
    const { userId } = await this.sessionIssuer.verifyMfaChallenge(mfaToken);
    const account = await this.users.findById(userId);
    if (!account) throw new DomainError('SESSION_INVALID', HTTP_STATUS.unauthorized);

    if (account.lockedUntil !== null && account.lockedUntil > new Date()) {
      throw new DomainError('MFA_CODE_INVALID', HTTP_STATUS.unauthorized);
    }
    const factor = await this.mfa.findFactor(userId);
    if (!factor?.isConfirmed) throw new DomainError('MFA_NOT_ENABLED', HTTP_STATUS.conflict);

    const issued = await this.codeIssuer.issue(account);
    return { emailHint: issued.emailHint, codeExpiresAt: issued.expiresAt };
  }
}

/**
 * Con la sesión iniciada: pide un código por correo para desactivar el segundo factor o regenerar los
 * códigos de recuperación cuando el método es el correo.
 */
@Injectable()
export class SendAccountEmailCodeUseCase {
  constructor(
    @Inject(USER_ACCOUNT_REPOSITORY) private readonly users: UserAccountRepository,
    @Inject(MFA_REPOSITORY) private readonly mfa: MfaRepository,
    private readonly codeIssuer: EmailSecondFactorCodeIssuer,
  ) {}

  async execute(userId: string): Promise<EmailCodeSent> {
    const account = await this.users.findById(userId);
    if (!account) throw new DomainError('UNAUTHENTICATED', HTTP_STATUS.unauthorized);

    const factor = await this.mfa.findFactor(userId);
    if (!factor?.isConfirmed) throw new DomainError('MFA_NOT_ENABLED', HTTP_STATUS.conflict);

    const issued = await this.codeIssuer.issue(account);
    return { emailHint: issued.emailHint, codeExpiresAt: issued.expiresAt };
  }
}
