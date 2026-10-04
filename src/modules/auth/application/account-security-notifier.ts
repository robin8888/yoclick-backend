import { Inject, Injectable } from '@nestjs/common';
import { EMAIL_SENDER, type EmailSender } from '../../../shared/email/email-sender';
import { buildAccountLockedMessage } from './account-email-messages';

interface AccountRecipient {
  readonly email: string;
  readonly fullName: string;
}

/** Avisos de seguridad a la persona, siempre por correo y nunca en la respuesta de la API. */
@Injectable()
export class AccountSecurityNotifier {
  constructor(@Inject(EMAIL_SENDER) private readonly emailSender: EmailSender) {}

  /**
   * La app no dice que la cuenta está bloqueada (sería confirmar que existe a quien la ataca): se
   * lo cuenta a su dueño por correo, una sola vez, en el momento en que empieza el bloqueo.
   */
  async sendAccountLockedNotice(recipient: AccountRecipient): Promise<void> {
    await this.emailSender.send(
      buildAccountLockedMessage({ to: recipient.email, fullName: recipient.fullName }),
    );
  }
}
