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

export const FAKE_WEBHOOK_SECRET_HEADER = 'x-voice-fake-secret';
export const FAKE_WEBHOOK_SECRET = 'fake-voice-secret';

const invocationSchema = z.object({
  providerCallId: z.string().min(1),
  toolCallId: z.string().min(1),
  calledNumber: z.string().min(1),
  callerNumber: z.string().min(1),
  arguments: z.unknown().optional(),
});

const callEndSchema = z.object({
  providerCallId: z.string().min(1),
  calledNumber: z.string().min(1),
  callerNumber: z.string().min(1),
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime(),
  summary: z.string().optional(),
  transcript: z.string().optional(),
  estimatedCostCents: z.number().int().nonnegative().optional(),
});

/** Proveedor de pega para desarrollo y tests: mensajes con la forma neutra y un secreto fijo en una cabecera. */
export class FakeVoiceAgentProvider implements VoiceAgentProvider {
  readonly providerName = 'fake';

  constructor(private readonly secret: string = FAKE_WEBHOOK_SECRET) {}

  isWebhookAuthentic(headers: Readonly<Record<string, string | string[] | undefined>>): boolean {
    const received = headers[FAKE_WEBHOOK_SECRET_HEADER];
    if (typeof received !== 'string') return false;
    const receivedBytes = Buffer.from(received);
    const expectedBytes = Buffer.from(this.secret);
    return (
      receivedBytes.length === expectedBytes.length && timingSafeEqual(receivedBytes, expectedBytes)
    );
  }

  parseToolInvocation(body: unknown): VoiceToolInvocation | null {
    const parsed = invocationSchema.safeParse(body);
    if (!parsed.success) return null;
    const calledNumber = normalizePhoneNumber(parsed.data.calledNumber);
    const callerNumber = normalizePhoneNumber(parsed.data.callerNumber);
    if (calledNumber === null || callerNumber === null) return null;
    return {
      providerCallId: parsed.data.providerCallId,
      toolCallId: parsed.data.toolCallId,
      calledNumber,
      callerNumber,
      rawArguments: parsed.data.arguments ?? {},
    };
  }

  parseCallEnd(body: unknown): VoiceCallEnd | null {
    const parsed = callEndSchema.safeParse(body);
    if (!parsed.success) return null;
    const calledNumber = normalizePhoneNumber(parsed.data.calledNumber);
    const callerNumber = normalizePhoneNumber(parsed.data.callerNumber);
    if (calledNumber === null || callerNumber === null) return null;
    const startedAt = new Date(parsed.data.startedAt);
    const endedAt = new Date(parsed.data.endedAt);
    return {
      providerCallId: parsed.data.providerCallId,
      calledNumber,
      callerNumber,
      startedAt,
      endedAt,
      durationSeconds: Math.max(
        Math.round((endedAt.getTime() - startedAt.getTime()) / MILLISECONDS_PER_SECOND),
        0,
      ),
      summary: parsed.data.summary ?? null,
      transcript: parsed.data.transcript ?? null,
      estimatedCostCents: parsed.data.estimatedCostCents ?? null,
    };
  }

  readServerMessageKind(body: unknown): VoiceServerMessageKind | null {
    const parsed = z.looseObject({ messageType: z.string() }).safeParse(body);
    if (!parsed.success) return null;
    const { messageType } = parsed.data;
    return messageType === 'end-of-call' || messageType === 'transfer-destination'
      ? messageType
      : null;
  }

  parseTransferDestinationRequest(body: unknown): VoiceToolInvocation | null {
    const parsed = invocationSchema.partial({ toolCallId: true }).safeParse(body);
    if (!parsed.success) return null;
    return this.parseToolInvocation({ ...parsed.data, toolCallId: 'transfer-destination' });
  }

  buildTransferDestinationResponse(reply: VoiceToolReply): Record<string, unknown> {
    if (reply.transferToNumber !== undefined) {
      return { destination: { type: 'number', number: reply.transferToNumber } };
    }
    return { error: reply.result['message'] ?? 'Transferencia no disponible.' };
  }

  buildToolResponse(toolCallId: string, reply: VoiceToolReply): Record<string, unknown> {
    return {
      toolCallId,
      result: reply.result,
      ...(reply.transferToNumber !== undefined && { transferToNumber: reply.transferToNumber }),
    };
  }
}
