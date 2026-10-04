import { Inject, Injectable } from '@nestjs/common';
import { EMAIL_SENDER, type EmailSender } from '../../../shared/email/email-sender';
import { MILLISECONDS_PER_MINUTE, MILLISECONDS_PER_SECOND } from '../../../shared/time/time-units';
import {
  EMAIL_VERIFICATION_CODE_TTL_MINUTES,
  generateVerificationCode,
  MIN_SECONDS_BETWEEN_CODES,
  PASSWORD_RESET_CODE_TTL_MINUTES,
} from '../domain/verification-code';
import {
  buildAlreadyRegisteredMessage,
  buildEmailVerificationMessage,
  buildPasswordResetMessage,
} from './account-email-messages';
import {
  VERIFICATION_CODE_HASHER,
  type VerificationCodeHasher,
} from './ports/verification-code.hasher';
import {
  VERIFICATION_CODE_REPOSITORY,
  type VerificationCodeRepository,
  type VerificationPurposeName,
} from './ports/verification-code.repository';

export interface CodeRecipient {
  readonly userId: string;
  readonly email: string;
  readonly fullName: string;
}

const CODE_TTL_MINUTES: Readonly<Record<VerificationPurposeName, number>> = {
  email_verification: EMAIL_VERIFICATION_CODE_TTL_MINUTES,
  password_reset: PASSWORD_RESET_CODE_TTL_MINUTES,
};

/** Genera, guarda (solo su HMAC) y envía por correo los códigos de 6 dígitos. */
@Injectable()
export class VerificationCodeIssuer {
  constructor(
    @Inject(VERIFICATION_CODE_REPOSITORY) private readonly codes: VerificationCodeRepository,
    @Inject(VERIFICATION_CODE_HASHER) private readonly codeHasher: VerificationCodeHasher,
    @Inject(EMAIL_SENDER) private readonly emailSender: EmailSender,
  ) {}

  /**
   * Si hay un código reciente, no se envía otro: así nadie puede usar la app para inundar un buzón.
   * La respuesta HTTP es la misma tanto si se envía como si no.
   */
  async issue(recipient: CodeRecipient, purpose: VerificationPurposeName): Promise<void> {
    const now = new Date();
    const recentCode = await this.codes.findActiveCode(recipient.userId, purpose, now);
    const cooldownMs = MIN_SECONDS_BETWEEN_CODES * MILLISECONDS_PER_SECOND;
    const isRecent =
      recentCode !== null && now.getTime() - recentCode.createdAt.getTime() < cooldownMs;
    if (isRecent) return;

    const code = generateVerificationCode();
    const validForMinutes = CODE_TTL_MINUTES[purpose];
    await this.codes.replaceActiveCode({
      userId: recipient.userId,
      purpose,
      codeHash: this.codeHasher.hash(code),
      expiresAt: new Date(now.getTime() + validForMinutes * MILLISECONDS_PER_MINUTE),
    });

    const details = { to: recipient.email, fullName: recipient.fullName, code, validForMinutes };
    await this.emailSender.send(
      purpose === 'email_verification'
        ? buildEmailVerificationMessage(details)
        : buildPasswordResetMessage(details),
    );
  }

  /** Para quien intenta registrarse con un correo que ya tiene cuenta: se le avisa en su buzón, no en la app. */
  async sendAlreadyRegisteredNotice(recipient: CodeRecipient): Promise<void> {
    await this.emailSender.send(
      buildAlreadyRegisteredMessage({ to: recipient.email, fullName: recipient.fullName }),
    );
  }
}
