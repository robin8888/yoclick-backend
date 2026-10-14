import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '../../../shared/errors/domain-error';
import { HTTP_STATUS } from '../../../shared/errors/http-status';
import { EMAIL_SENDER, type EmailSender } from '../../../shared/email/email-sender';
import { MILLISECONDS_PER_MINUTE } from '../../../shared/time/time-units';
import {
  EMAIL_SECOND_FACTOR_CODE_TTL_MINUTES,
  isResendTooSoon,
  maskEmailAddress,
} from '../domain/email-second-factor';
import { generateVerificationCode } from '../domain/verification-code';
import { buildSecondFactorCodeMessage } from './account-email-messages';
import {
  VERIFICATION_CODE_HASHER,
  type VerificationCodeHasher,
} from './ports/verification-code.hasher';
import {
  VERIFICATION_CODE_REPOSITORY,
  type VerificationCodeRepository,
} from './ports/verification-code.repository';
import { type UserAccount } from './ports/user-account.repository';
import { SecondFactorSecurityEvents } from './second-factor-security-events';

export interface IssuedEmailSecondFactorCode {
  readonly emailHint: string;
  readonly expiresAt: Date;
}

/**
 * Envía el código de 6 dígitos del segundo factor al correo de la persona. A diferencia de los
 * códigos de verificar el correo (que callan), aquí quien pide ya está identificada, así que pedir otro
 * antes de 60 s responde 429: la app puede decirle que espere. Emitir uno invalida el anterior.
 */
@Injectable()
export class EmailSecondFactorCodeIssuer {
  constructor(
    @Inject(VERIFICATION_CODE_REPOSITORY) private readonly codes: VerificationCodeRepository,
    @Inject(VERIFICATION_CODE_HASHER) private readonly codeHasher: VerificationCodeHasher,
    @Inject(EMAIL_SENDER) private readonly emailSender: EmailSender,
    private readonly securityEvents: SecondFactorSecurityEvents,
  ) {}

  async issue(account: UserAccount): Promise<IssuedEmailSecondFactorCode> {
    const now = new Date();
    const recentCode = await this.codes.findActiveCode(account.id, 'mfa_email', now);
    if (recentCode !== null && isResendTooSoon(recentCode.createdAt, now)) {
      this.securityEvents.record('mfa_email_code_send_throttled', account.id);
      throw new DomainError('RATE_LIMITED', HTTP_STATUS.tooManyRequests);
    }

    const code = generateVerificationCode();
    const expiresAt = new Date(
      now.getTime() + EMAIL_SECOND_FACTOR_CODE_TTL_MINUTES * MILLISECONDS_PER_MINUTE,
    );
    await this.codes.replaceActiveCode({
      userId: account.id,
      purpose: 'mfa_email',
      codeHash: this.codeHasher.hash(code),
      expiresAt,
    });
    await this.emailSender.send(
      buildSecondFactorCodeMessage({
        to: account.email,
        fullName: account.fullName,
        code,
        validForMinutes: EMAIL_SECOND_FACTOR_CODE_TTL_MINUTES,
      }),
    );
    this.securityEvents.record('mfa_email_code_sent', account.id);
    return { emailHint: maskEmailAddress(account.email), expiresAt };
  }
}
