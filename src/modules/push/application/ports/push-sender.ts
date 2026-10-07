export interface PushMessage {
  /** Token de Expo del móvil (`ExponentPushToken[...]`). */
  readonly to: string;
  readonly title: string;
  readonly body: string;
  /** Lo que la app necesita para abrir el aviso: nunca datos personales (SEC-M5). */
  readonly data: Readonly<Record<string, string>>;
}

export interface PushSendResult {
  /** Tokens que el servicio dice que ya no existen (app desinstalada): se borran. */
  readonly invalidTokens: readonly string[];
}

export interface PushSender {
  send(messages: readonly PushMessage[]): Promise<PushSendResult>;
}

export const PUSH_SENDER = Symbol('PUSH_SENDER');
