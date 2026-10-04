import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type Environment } from '../config/environment.schema';
import { EmailDeliveryError, type EmailMessage, type EmailSender } from './email-sender';

const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Envío por la API HTTP de Brevo (mejor diagnóstico que SMTP y sin conexiones abiertas).
 *
 * Los fallos se convierten en `EmailDeliveryError`, que solo lleva el estado HTTP: el cuerpo de la
 * respuesta del proveedor puede repetir el destinatario o la clave, y no debe llegar a los logs.
 */
@Injectable()
export class BrevoEmailSender implements EmailSender {
  private readonly apiKey: string;
  private readonly fromAddress: string;
  private readonly fromName: string;

  constructor(configService: ConfigService<Environment, true>) {
    // Opcionales en la configuración: solo son obligatorias con EMAIL_PROVIDER=brevo, que ya las exige.
    const apiKey: string | undefined = configService.get('BREVO_API_KEY', { infer: true });
    const fromAddress: string | undefined = configService.get('EMAIL_FROM_ADDRESS', {
      infer: true,
    });
    this.apiKey = apiKey ?? '';
    this.fromAddress = fromAddress ?? '';
    this.fromName = configService.get('EMAIL_FROM_NAME', { infer: true });
  }

  async send(message: EmailMessage): Promise<void> {
    const response = await this.postToBrevo(message);
    if (!response.ok) throw new EmailDeliveryError(response.status);
  }

  private async postToBrevo(message: EmailMessage): Promise<Response> {
    try {
      return await fetch(BREVO_ENDPOINT, {
        method: 'POST',
        headers: {
          'api-key': this.apiKey,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          sender: { name: this.fromName, email: this.fromAddress },
          to: [{ email: message.to }],
          subject: message.subject,
          textContent: message.textBody,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new EmailDeliveryError();
    }
  }
}
