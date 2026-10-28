import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { type VoiceCapabilities } from '../domain/voice-capabilities';
import { type VoiceAgentConfigView, type VoiceCallerView } from './ports/voice-call.repository';
import { type VoiceToolReply } from './ports/voice-agent-provider';

/** Todo lo que una herramienta sabe de la llamada. Sale de la llamada y de la base de datos, nunca del modelo. */
export interface VoiceCallContext {
  readonly centerId: string;
  readonly planId: string;
  readonly timeZone: string;
  readonly disabledModules: readonly string[];
  readonly capabilities: VoiceCapabilities;
  readonly config: VoiceAgentConfigView | null;
  readonly callerNumber: string;
  readonly providerCallId: string;
  readonly toolCallId: string;
  /** Con quién se identificó quien llama en esta llamada; `null` mientras no lo haya hecho. */
  readonly caller: VoiceCallerView | null;
  readonly now: Date;
}

/** Quien llama, con los mismos permisos que tendría en la app: una persona cliente del centro. */
export function buildCallerActor(context: VoiceCallContext, caller: VoiceCallerView): ActorContext {
  return {
    userId: caller.userId,
    centerId: context.centerId,
    membershipId: caller.membershipId,
    role: 'client',
    permissions: [],
  };
}

/**
 * Para consultar huecos antes de saber quién llama: ve lo mismo que cualquier cliente (servicios visibles,
 * horas libres) y no lleva ninguna persona detrás.
 */
export function buildVisitorActor(context: VoiceCallContext): ActorContext {
  return {
    userId: '',
    centerId: context.centerId,
    membershipId: '',
    role: 'client',
    permissions: [],
  };
}

export function replyOk(details: Record<string, unknown>): VoiceToolReply {
  return { result: { ok: true, ...details } };
}

/** Un rechazo de negocio: el bot lo lee y se lo explica a quien llama; no es un error del servidor. */
export function replyRefused(
  reason: string,
  message: string,
  extra: Record<string, unknown> = {},
): VoiceToolReply {
  return { result: { ok: false, reason, message, ...extra } };
}
