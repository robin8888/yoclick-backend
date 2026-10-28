import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { MILLISECONDS_PER_SECOND } from '../../../shared/time/time-units';
import { normalizePhoneNumber } from '../domain/phone-number';
import {
  type VoiceAgentProvider,
  type VoiceCallEnd,
  type VoiceServerMessageKind,
  type VoiceToolInvocation,
  type VoiceToolReply,
} from '../application/ports/voice-agent-provider';

const LEGACY_SECRET_HEADER = 'x-vapi-secret';
const AUTHORIZATION_HEADER = 'authorization';
const BEARER_PREFIX = /^Bearer\s+/iu;
const CENTS_PER_DOLLAR = 100;

const phoneSchema = z.looseObject({
  number: z.string().min(1).optional(),
  twilioPhoneNumber: z.string().min(1).optional(),
});

const callSchema = z.looseObject({
  id: z.string().min(1),
  phoneNumber: phoneSchema.optional(),
  customer: phoneSchema.optional(),
  startedAt: z.string().optional(),
  endedAt: z.string().optional(),
});

// Vapi manda cada orden como `{ id, type: 'function', function: { name, arguments } }`; se acepta también
// `arguments` suelto por si el formato cambia.
const toolCallSchema = z.looseObject({
  id: z.string().min(1),
  arguments: z.unknown().optional(),
  function: z.looseObject({ arguments: z.unknown().optional() }).optional(),
});

const messageTypeSchema = z.looseObject({ message: z.looseObject({ type: z.string() }) });

const SERVER_MESSAGE_KINDS: Readonly<Record<string, VoiceServerMessageKind | undefined>> = {
  'end-of-call-report': 'end-of-call',
  'transfer-destination-request': 'transfer-destination',
};

const toolMessageSchema = z.looseObject({
  message: z.looseObject({
    type: z.literal('tool-calls'),
    call: callSchema,
    phoneNumber: phoneSchema.optional(),
    customer: phoneSchema.optional(),
    toolCallList: z.array(toolCallSchema).min(1),
  }),
});

const transferRequestSchema = z.looseObject({
  message: z.looseObject({
    type: z.literal('transfer-destination-request'),
    call: callSchema,
    phoneNumber: phoneSchema.optional(),
    customer: phoneSchema.optional(),
  }),
});

const callEndMessageSchema = z.looseObject({
  message: z.looseObject({
    type: z.literal('end-of-call-report'),
    call: callSchema,
    phoneNumber: phoneSchema.optional(),
    customer: phoneSchema.optional(),
    // El resumen y la transcripción han cambiado de sitio entre versiones de Vapi: se leen de los dos.
    analysis: z.looseObject({ summary: z.string().optional() }).optional(),
    artifact: z.looseObject({ transcript: z.string().optional() }).optional(),
    summary: z.string().optional(),
    transcript: z.string().optional(),
    cost: z.number().nonnegative().optional(),
    startedAt: z.string().optional(),
    endedAt: z.string().optional(),
  }),
});

function readHeader(
  headers: Readonly<Record<string, string | string[] | undefined>>,
  name: string,
): string | null {
  const value = headers[name];
  if (typeof value === 'string') return value;
  return Array.isArray(value) ? (value[0] ?? null) : null;
}

function isSameSecret(received: string, expected: string): boolean {
  const receivedBytes = Buffer.from(received);
  const expectedBytes = Buffer.from(expected);
  return (
    receivedBytes.length === expectedBytes.length && timingSafeEqual(receivedBytes, expectedBytes)
  );
}

type PhoneInfo = z.infer<typeof phoneSchema> | undefined;

function readPhoneDigits(...candidates: readonly PhoneInfo[]): string | null {
  for (const candidate of candidates) {
    const digits = candidate?.number ?? candidate?.twilioPhoneNumber;
    if (digits !== undefined) return digits;
  }
  return null;
}

/** Los números salen de la llamada firmada por Vapi, en `call` o en el propio aviso. */
function readNumbers(
  call: z.infer<typeof callSchema>,
  message: { phoneNumber?: PhoneInfo; customer?: PhoneInfo },
): { called: string; caller: string } | null {
  const called = normalizePhoneNumber(readPhoneDigits(call.phoneNumber, message.phoneNumber) ?? '');
  const caller = normalizePhoneNumber(readPhoneDigits(call.customer, message.customer) ?? '');
  return called === null || caller === null ? null : { called, caller };
}

/** Los argumentos llegan como objeto; si vinieran como texto JSON se leen, y si no se pueden leer se rechazan al validar. */
function readToolArguments(toolCall: z.infer<typeof toolCallSchema>): unknown {
  const rawArguments = toolCall.function?.arguments ?? toolCall.arguments;
  if (typeof rawArguments !== 'string') return rawArguments;
  try {
    return JSON.parse(rawArguments) as unknown;
  } catch {
    return rawArguments;
  }
}

type CallEndMessage = z.infer<typeof callEndMessageSchema>['message'];

/** El resumen y la transcripción: en `analysis` y `artifact` (formato actual) o sueltos (formato anterior). */
function readCallTexts(
  message: Pick<CallEndMessage, 'analysis' | 'artifact' | 'summary' | 'transcript'>,
): {
  summary: string | null;
  transcript: string | null;
} {
  return {
    summary: message.analysis?.summary ?? message.summary ?? null,
    transcript: message.artifact?.transcript ?? message.transcript ?? null,
  };
}

/** Inicio, fin y duración de la llamada: de `call` o, si no, del propio aviso. */
function readCallTimes(
  call: z.infer<typeof callSchema>,
  message: { startedAt?: string | undefined; endedAt?: string | undefined },
): { startedAt: Date; endedAt: Date; durationSeconds: number } | null {
  const startedAt = parseDate(call.startedAt ?? message.startedAt);
  const endedAt = parseDate(call.endedAt ?? message.endedAt);
  if (startedAt === null || endedAt === null) return null;
  const elapsedSeconds = Math.round(
    (endedAt.getTime() - startedAt.getTime()) / MILLISECONDS_PER_SECOND,
  );
  return { startedAt, endedAt, durationSeconds: Math.max(elapsedSeconds, 0) };
}

function parseDate(raw: string | undefined): Date | null {
  if (raw === undefined) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Adaptador de Vapi (https://docs.vapi.ai). Los avisos llevan el secreto del servidor en
 * `Authorization: Bearer <secreto>` (credencial estándar) o, con una credencial «legacy», en `X-Vapi-Secret`.
 * Los nombres de campo siguen la documentación de «server messages»; hay que confirmarlos contra una llamada
 * real al configurar el asistente (docs/guides/contestador-ia-vapi.md).
 */
export class VapiVoiceAgentProvider implements VoiceAgentProvider {
  readonly providerName = 'vapi';

  constructor(private readonly webhookSecret: string) {}

  isWebhookAuthentic(headers: Readonly<Record<string, string | string[] | undefined>>): boolean {
    const legacySecret = readHeader(headers, LEGACY_SECRET_HEADER);
    if (legacySecret !== null && isSameSecret(legacySecret, this.webhookSecret)) return true;
    const authorization = readHeader(headers, AUTHORIZATION_HEADER);
    if (authorization === null || !BEARER_PREFIX.test(authorization)) return false;
    return isSameSecret(authorization.replace(BEARER_PREFIX, ''), this.webhookSecret);
  }

  parseToolInvocation(body: unknown): VoiceToolInvocation | null {
    const parsed = toolMessageSchema.safeParse(body);
    if (!parsed.success) return null;
    const { call, toolCallList } = parsed.data.message;
    const numbers = readNumbers(call, parsed.data.message);
    const [toolCall] = toolCallList;
    if (numbers === null || toolCall === undefined) return null;
    return {
      providerCallId: call.id,
      toolCallId: toolCall.id,
      calledNumber: numbers.called,
      callerNumber: numbers.caller,
      rawArguments: readToolArguments(toolCall),
    };
  }

  readServerMessageKind(body: unknown): VoiceServerMessageKind | null {
    const parsed = messageTypeSchema.safeParse(body);
    if (!parsed.success) return null;
    return SERVER_MESSAGE_KINDS[parsed.data.message.type] ?? null;
  }

  parseTransferDestinationRequest(body: unknown): VoiceToolInvocation | null {
    const parsed = transferRequestSchema.safeParse(body);
    if (!parsed.success) return null;
    const { call } = parsed.data.message;
    const numbers = readNumbers(call, parsed.data.message);
    if (numbers === null) return null;
    return {
      providerCallId: call.id,
      toolCallId: 'transfer-destination',
      calledNumber: numbers.called,
      callerNumber: numbers.caller,
      rawArguments: {},
    };
  }

  buildTransferDestinationResponse(reply: VoiceToolReply): Record<string, unknown> {
    if (reply.transferToNumber !== undefined) {
      return { destination: { type: 'number', number: reply.transferToNumber } };
    }
    const refusal = reply.result['message'];
    return { error: typeof refusal === 'string' ? refusal : 'No se puede pasar la llamada ahora.' };
  }

  parseCallEnd(body: unknown): VoiceCallEnd | null {
    const parsed = callEndMessageSchema.safeParse(body);
    if (!parsed.success) return null;
    const { call, cost, ...message } = parsed.data.message;
    const numbers = readNumbers(call, message);
    const times = readCallTimes(call, message);
    if (numbers === null || times === null) return null;
    return {
      providerCallId: call.id,
      calledNumber: numbers.called,
      callerNumber: numbers.caller,
      ...times,
      ...readCallTexts(message),
      estimatedCostCents: cost === undefined ? null : Math.round(cost * CENTS_PER_DOLLAR),
    };
  }

  buildToolResponse(toolCallId: string, reply: VoiceToolReply): Record<string, unknown> {
    // `result` debe ser un texto de una sola línea: JSON.stringify escapa los saltos de línea.
    return { results: [{ toolCallId, result: JSON.stringify(reply.result) }] };
  }
}
