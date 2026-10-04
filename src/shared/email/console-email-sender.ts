import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { type EmailMessage, type EmailSender } from './email-sender';

/**
 * Solo desarrollo: imprime el correo en el log en lugar de enviarlo, para poder recorrer el flujo
 * sin proveedor (el código de verificación sale aquí). El destinatario NO se imprime. En producción
 * la configuración impide arrancar con este proveedor.
 */
@Injectable()
export class ConsoleEmailSender implements EmailSender {
  constructor(private readonly logger: PinoLogger) {}

  send(message: EmailMessage): Promise<void> {
    this.logger.info(
      { emailSubject: message.subject, emailBody: message.textBody },
      'Email (console provider, not delivered)',
    );
    return Promise.resolve();
  }
}
