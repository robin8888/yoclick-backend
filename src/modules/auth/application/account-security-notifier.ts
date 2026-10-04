import { Inject, Injectable } from '@nestjs/common';
import { EMAIL_SENDER, type EmailSender } from '../../../shared/email/email-sender';
import { buildAccountLockedMessage, buildPasswordChangedMessage } from './account-email-messages';

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

  /**
   * Si la persona no ha cambiado su contraseña, este correo es la alarma: alguien tiene acceso a su
   * buzón o a su cuenta. Se envía siempre que cambia la contraseña, por cualquier camino.
   */
  async sendPasswordChangedNotice(recipient: AccountRecipient): Promise<void> {
    await this.emailSender.send(
      buildPasswordChangedMessage({ to: recipient.email, fullName: recipient.fullName }),
    );
  }
}
