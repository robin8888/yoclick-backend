import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '../../../shared/errors/domain-error';
import { HTTP_STATUS } from '../../../shared/errors/http-status';
import { EmailSecondFactorCodeIssuer } from './email-second-factor-code-issuer';
import { MFA_REPOSITORY, type MfaRepository } from './ports/mfa.repository';
import { ReauthenticationChecker } from './reauthentication.checker';

export interface EmailMfaSetup {
  readonly emailHint: string;
  readonly codeExpiresAt: Date;
}

/**
 * Empieza a activar el segundo factor por correo. Exige la contraseña (SEC-12), como el alta con app.
 * El factor queda sin confirmar hasta que la persona escribe el primer código: así demuestra que su
 * buzón funciona y no se queda fuera de su cuenta por un correo inaccesible.
 */
@Injectable()
export class SetupEmailMfaUseCase {
  constructor(
    private readonly reauthenticationChecker: ReauthenticationChecker,
    @Inject(MFA_REPOSITORY) private readonly mfa: MfaRepository,
    private readonly codeIssuer: EmailSecondFactorCodeIssuer,
  ) {}

  async execute(userId: string, password: string): Promise<EmailMfaSetup> {
    const account = await this.reauthenticationChecker.assertPasswordIsCorrect(userId, password);

    const wasSaved = await this.mfa.saveUnconfirmedEmailFactor(userId);
    if (!wasSaved) throw new DomainError('MFA_ALREADY_ENABLED', HTTP_STATUS.conflict);

    const issued = await this.codeIssuer.issue(account);
    return { emailHint: issued.emailHint, codeExpiresAt: issued.expiresAt };
  }
}
