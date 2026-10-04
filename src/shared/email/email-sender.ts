export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  /** Solo texto: sin HTML no hay enlaces camuflados ni contenido activo, y llega a todos los clientes. */
  readonly textBody: string;
}

/** Puerto de envío de correo. Hoy `console` (desarrollo) y Brevo; cambiar de proveedor no toca los casos de uso. */
export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

export const EMAIL_SENDER = Symbol('EMAIL_SENDER');

/** Fallo al entregar un correo. Lleva el estado HTTP, nunca el contenido ni el destinatario. */
export class EmailDeliveryError extends Error {
  constructor(readonly providerStatusCode?: number) {
    super('Email delivery failed');
    this.name = 'EmailDeliveryError';
  }
}
