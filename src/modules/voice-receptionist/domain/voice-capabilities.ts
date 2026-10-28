import { doesPlanIncludeFeature } from '../../../shared/centers/plan-features';

/**
 * Lo que puede hacer el bot según el plan del centro. No hay una tabla propia: se pregunta a la misma que ya
 * decide qué rutas abre cada plan (`plan-features.ts`), así que si el centro cambia de plan las capacidades
 * del bot cambian solas.
 */
export interface VoiceCapabilities {
  /** Apuntar a la lista de espera de una clase llena. */
  readonly canJoinWaitlist: boolean;
  /** Clases en grupo (y sus salas). */
  readonly canBookGroupSessions: boolean;
  /** Reservar para un hijo o tutelado. */
  readonly canBookForChildren: boolean;
  /** Saludo y nombre del asistente propios. */
  readonly canCustomizeAssistant: boolean;
  /** Mandar por email un enlace de pago (nunca se cobra por voz). */
  readonly canSendPaymentLink: boolean;
}

export function resolveVoiceCapabilities(planId: string): VoiceCapabilities {
  return {
    canJoinWaitlist: doesPlanIncludeFeature(planId, 'waitlist'),
    canBookGroupSessions:
      doesPlanIncludeFeature(planId, 'groups') && doesPlanIncludeFeature(planId, 'rooms'),
    canBookForChildren: doesPlanIncludeFeature(planId, 'families'),
    canCustomizeAssistant: doesPlanIncludeFeature(planId, 'customAppearance'),
    canSendPaymentLink: doesPlanIncludeFeature(planId, 'onlinePayments'),
  };
}
