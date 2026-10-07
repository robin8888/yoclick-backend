import { Logger } from '@nestjs/common';
import {
  type PushMessage,
  type PushSender,
  type PushSendResult,
} from '../application/ports/push-sender';

/**
 * Solo desarrollo: anota en el log que habría enviado avisos, sin entregarlos. No imprime ni el
 * token ni el texto. En producción la configuración impide arrancar con este proveedor.
 */
export class ConsolePushSender implements PushSender {
  private readonly logger = new Logger(ConsolePushSender.name);

  send(messages: readonly PushMessage[]): Promise<PushSendResult> {
    this.logger.log(`Push (console provider, not delivered): ${String(messages.length)} messages`);
    return Promise.resolve({ invalidTokens: [] });
  }
}
