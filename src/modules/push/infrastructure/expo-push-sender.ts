import {
  type PushMessage,
  type PushSender,
  type PushSendResult,
} from '../application/ports/push-sender';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
/** El servicio de Expo admite hasta 100 mensajes por petición. */
const MAX_MESSAGES_PER_REQUEST = 100;
const REQUEST_TIMEOUT_MS = 10_000;

interface ExpoTicket {
  readonly status: 'ok' | 'error';
  readonly details?: { readonly error?: string };
}

function chunk<TItem>(items: readonly TItem[], size: number): TItem[][] {
  const chunks: TItem[][] = [];
  for (let start = 0; start < items.length; start += size) {
    chunks.push(items.slice(start, start + size));
  }
  return chunks;
}

/**
 * Entrega los avisos con el servicio de Expo. Si Expo no responde lanza el error: quien lo llama
 * deja el aviso sin marcar como enviado para reintentarlo, y no tumba la acción que lo provocó.
 */
export class ExpoPushSender implements PushSender {
  constructor(private readonly accessToken: string | undefined) {}

  async send(messages: readonly PushMessage[]): Promise<PushSendResult> {
    const invalidTokens: string[] = [];
    for (const batch of chunk(messages, MAX_MESSAGES_PER_REQUEST)) {
      const tickets = await this.sendBatch(batch);
      tickets.forEach((ticket, index) => {
        const isDeadToken =
          ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered';
        const token = batch[index]?.to;
        if (isDeadToken && token) invalidTokens.push(token);
      });
    }
    return { invalidTokens };
  }

  private async sendBatch(batch: readonly PushMessage[]): Promise<ExpoTicket[]> {
    const response = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(this.accessToken && { Authorization: `Bearer ${this.accessToken}` }),
      },
      body: JSON.stringify(batch.map((message) => ({ ...message, sound: 'default' }))),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Expo push service answered ${String(response.status)}`);
    const body = (await response.json()) as { data?: ExpoTicket[] };
    return body.data ?? [];
  }
}
