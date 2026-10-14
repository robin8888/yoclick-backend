import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

export type SecondFactorSecurityEvent =
  | 'mfa_email_code_sent'
  | 'mfa_email_code_send_throttled'
  | 'mfa_email_code_used'
  | 'mfa_email_code_failed';

/**
 * Deja constancia de lo que ocurre con los códigos del segundo factor por correo. Solo guarda el
 * evento y el id de la persona: nunca el código, su hash ni el correo.
 */
@Injectable()
export class SecondFactorSecurityEvents {
  constructor(private readonly logger: PinoLogger) {}

  record(event: SecondFactorSecurityEvent, userId: string): void {
    this.logger.info({ securityEvent: event, userId }, 'Security event');
  }
}
