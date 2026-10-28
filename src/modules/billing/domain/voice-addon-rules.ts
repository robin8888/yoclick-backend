import { type SubscriptionStatus } from './subscription-rules';

export type VoiceSubscriptionState = 'active' | 'paused' | 'cancelled';

/**
 * En qué estado queda el add-on del Contestador IA cuando cambia la suscripción de Stripe del centro:
 * - si las líneas del add-on ya no están en la suscripción, o la suscripción se canceló, queda cancelado;
 * - con un cobro fallido o la suscripción detenida queda en pausa (el bot no atiende y, si el pago se arregla,
 *   vuelve solo);
 * - con la suscripción al día queda activo, salvo que estuviera cancelado y el aviso no confirme que las líneas
 *   siguen ahí: un add-on cancelado no resucita por un aviso cualquiera.
 */
export function decideVoiceSubscriptionState(input: {
  readonly current: VoiceSubscriptionState;
  readonly stripeStatus: SubscriptionStatus;
  /** `null` si el aviso no traía las líneas de la suscripción. */
  readonly isAddonPresent: boolean | null;
}): VoiceSubscriptionState {
  const { current, stripeStatus, isAddonPresent } = input;
  if (isAddonPresent === false || stripeStatus === 'canceled') return 'cancelled';
  if (stripeStatus === 'active' || stripeStatus === 'trialing') {
    return current === 'cancelled' && isAddonPresent !== true ? 'cancelled' : 'active';
  }
  return current === 'cancelled' ? 'cancelled' : 'paused';
}
