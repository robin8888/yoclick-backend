export type VoiceServerMessageKind = 'end-of-call' | 'transfer-destination';

/** Una orden del agente de voz (una herramienta) ya leída del formato del proveedor. */
export interface VoiceToolInvocation {
  /** Id de la llamada que pone el proveedor: de él cuelga la identidad de quien llama, no de lo que diga el modelo. */
  readonly providerCallId: string;
  readonly toolCallId: string;
  /** Número puente al que se llamó (E.164): lo único que decide de qué centro es la llamada. */
  readonly calledNumber: string;
  readonly callerNumber: string;
  /** Los argumentos que ha escrito el modelo de lenguaje: no son de fiar y se validan con zod. */
  readonly rawArguments: unknown;
}

export interface VoiceCallEnd {
  readonly providerCallId: string;
  readonly calledNumber: string;
  readonly callerNumber: string;
  readonly startedAt: Date;
  readonly endedAt: Date;
  readonly durationSeconds: number;
  readonly summary: string | null;
  readonly transcript: string | null;
  readonly estimatedCostCents: number | null;
}

/** Lo que el bot recibe de vuelta: un texto (JSON) que el modelo lee, y opcionalmente a quién pasar la llamada. */
export interface VoiceToolReply {
  readonly result: Record<string, unknown>;
  readonly transferToNumber?: string;
}

/**
 * Lo único que la lógica del contestador sabe del proveedor de voz (Vapi hoy). Cambiar de proveedor es escribir
 * otro adaptador: ni los casos de uso ni los controladores conocen el formato de sus mensajes.
 */
export interface VoiceAgentProvider {
  readonly providerName: 'vapi' | 'fake';
  /** Comprueba el secreto compartido de los avisos (comparación de tiempo constante). */
  isWebhookAuthentic(headers: Readonly<Record<string, string | string[] | undefined>>): boolean;
  /** `null` si el cuerpo no es una orden de herramienta bien formada. */
  parseToolInvocation(body: unknown): VoiceToolInvocation | null;
  parseCallEnd(body: unknown): VoiceCallEnd | null;
  /**
   * De qué trata un aviso que el proveedor manda a la URL del servidor del asistente (que es una sola para todos):
   * el informe de fin de llamada o la petición de destino de una transferencia. `null` si es de otro tipo.
   */
  readServerMessageKind(body: unknown): VoiceServerMessageKind | null;
  /** El cuerpo de la respuesta HTTP en el formato que el proveedor espera. */
  buildToolResponse(toolCallId: string, reply: VoiceToolReply): Record<string, unknown>;
  /**
   * La petición del proveedor para saber a quién pasar la llamada (la herramienta nativa de transferencia, sin
   * destino fijo). Se lee con la misma forma que una orden de herramienta; `null` si no está bien formada.
   */
  parseTransferDestinationRequest(body: unknown): VoiceToolInvocation | null;
  /** La respuesta a esa petición: el destino al que pasar la llamada o un rechazo que el bot leerá. */
  buildTransferDestinationResponse(reply: VoiceToolReply): Record<string, unknown>;
}

export const VOICE_AGENT_PROVIDER = Symbol('VOICE_AGENT_PROVIDER');
