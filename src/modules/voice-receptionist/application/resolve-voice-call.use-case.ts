import { Inject, Injectable } from '@nestjs/common';
import { shouldBotAnswer } from '../domain/usage-minutes';
import { resolveVoiceCapabilities } from '../domain/voice-capabilities';
import { type VoiceToolInvocation, type VoiceToolReply } from './ports/voice-agent-provider';
import {
  VOICE_CALL_REPOSITORY,
  type VoiceCallRepository,
  type VoiceCenterSnapshot,
} from './ports/voice-call.repository';
import { replyRefused, type VoiceCallContext } from './voice-call-context';

export type ResolvedVoiceCall =
  | { readonly kind: 'ready'; readonly context: VoiceCallContext }
  | { readonly kind: 'unavailable'; readonly reply: VoiceToolReply };

const UNAVAILABLE_MESSAGE =
  'El asistente no está disponible ahora mismo. Pide disculpas y pasa la llamada a una persona.';

/**
 * Por qué el bot no atiende, si no atiende. Con «apagar al agotar» y los minutos incluidos gastados deja de
 * contestar y la línea suena como siempre.
 */
function describeRefusal(center: VoiceCenterSnapshot | null): string | null {
  if (center === null || center.isClosed || !center.isVoiceReceptionistEnabled) {
    return 'service_not_enabled';
  }
  if (center.subscriptionStatus !== 'active') return 'subscription_not_active';
  const isExhausted =
    center.usage !== null &&
    !shouldBotAnswer({
      overagePolicy: center.config?.overagePolicy ?? 'continue_and_charge',
      ...center.usage,
    });
  return isExhausted ? 'included_minutes_exhausted' : null;
}

function unavailable(reason: string): ResolvedVoiceCall {
  return {
    kind: 'unavailable',
    reply: replyRefused(reason, UNAVAILABLE_MESSAGE, { shouldTransfer: true }),
  };
}

/**
 * Convierte una orden del proveedor en el contexto de una llamada. El centro se decide SOLO por el número
 * puente al que se llamó; con el interruptor apagado, sin suscripción en vigor o con el centro cerrado, el
 * bot recibe «no disponible» y la llamada sigue su camino normal.
 */
@Injectable()
export class ResolveVoiceCallUseCase {
  constructor(@Inject(VOICE_CALL_REPOSITORY) private readonly calls: VoiceCallRepository) {}

  async execute(invocation: VoiceToolInvocation, now: Date): Promise<ResolvedVoiceCall> {
    const line = await this.calls.findLineByNumber(invocation.calledNumber);
    if (line === null || !line.isActive) return unavailable('line_not_available');

    const center = await this.calls.loadCenterSnapshot(line.centerId, now);
    const refusal = describeRefusal(center);
    if (center === null || refusal !== null) return unavailable(refusal ?? 'service_not_enabled');

    const { callerMembershipId } = await this.calls.openCallLog(center.centerId, {
      providerCallId: invocation.providerCallId,
      callerPhone: invocation.callerNumber,
      now,
    });
    const caller =
      callerMembershipId === null
        ? null
        : await this.calls.findCallerByMembershipId(center.centerId, callerMembershipId);

    return {
      kind: 'ready',
      context: {
        centerId: center.centerId,
        planId: center.planId,
        timeZone: center.timeZone,
        disabledModules: center.disabledModules,
        capabilities: resolveVoiceCapabilities(center.planId),
        config: center.config,
        callerNumber: invocation.callerNumber,
        providerCallId: invocation.providerCallId,
        toolCallId: invocation.toolCallId,
        caller,
        now,
      },
    };
  }
}
