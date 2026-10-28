import { decideVoiceSubscriptionState } from '../domain/voice-addon-rules';
import { type BillingEvent, type BillingGateway } from './ports/billing-gateway';
import {
  type BillingCenter,
  type BillingTransaction,
  type BillingVoiceSubscription,
  type BillingVoiceSubscriptionChanges,
} from './ports/billing.repository';

type SubscriptionChangedEvent = Extract<BillingEvent, { type: 'subscription_changed' }>;

interface VoiceAddonSyncInput {
  readonly transaction: BillingTransaction;
  readonly gateway: BillingGateway;
  /** El centro tal y como estaba antes de aplicar este aviso: su plan es el anterior. */
  readonly centerBeforeEvent: BillingCenter;
  readonly event: SubscriptionChangedEvent;
}

/**
 * Cuando cambia la suscripción de Stripe de un centro con el add-on del Contestador IA, el add-on la sigue:
 * estado (activo, en pausa o cancelado), periodo de cobro (de él salen los minutos del periodo) y, si el centro
 * cambia de plan, minutos incluidos y precio del escalón. Las capacidades del bot se derivan del plan, así que
 * no hay nada más que sincronizar.
 *
 * El cambio de precio en Stripe se hace dentro de la transacción del aviso: si falla, el aviso no queda
 * apuntado como atendido y Stripe lo reintenta, en lugar de dejar los minutos de un plan con el precio de otro.
 */
export async function syncVoiceAddonWithSubscription(input: VoiceAddonSyncInput): Promise<void> {
  const { transaction, centerBeforeEvent, event } = input;
  const voice = await transaction.findVoiceSubscription(centerBeforeEvent.id);
  if (voice === null) return;

  const nextStatus = decideVoiceSubscriptionState({
    current: voice.status,
    stripeStatus: event.status,
    isAddonPresent: event.voiceAddon?.isPresent ?? null,
  });
  const changes: BillingVoiceSubscriptionChanges = {
    ...(nextStatus === voice.status ? {} : { status: nextStatus }),
    ...readPeriodChange(voice, event),
    ...(nextStatus === 'cancelled' ? {} : await repriceOnPlanChange(input, voice)),
  };
  if (Object.keys(changes).length === 0) return;

  await transaction.updateVoiceSubscription(centerBeforeEvent.id, changes);
  if (nextStatus !== voice.status) {
    await transaction.writeAudit({
      centerId: centerBeforeEvent.id,
      action: 'voice_addon_status_changed',
      details: { from: voice.status, to: nextStatus, stripeStatus: event.status },
    });
  }
  // Cancelado: el interruptor del centro se apaga solo; si se vuelve a contratar, lo enciende el centro.
  if (nextStatus === 'cancelled' && voice.status !== 'cancelled') {
    await transaction.updateCenter(centerBeforeEvent.id, { isVoiceReceptionistEnabled: false });
  }
}

function readPeriodChange(
  voice: BillingVoiceSubscription,
  event: SubscriptionChangedEvent,
): BillingVoiceSubscriptionChanges {
  const period = event.voiceAddon;
  if (period?.periodStart == null || period.periodEnd == null) return {};
  const isSamePeriod =
    period.periodStart.getTime() === voice.periodStart.getTime() &&
    period.periodEnd.getTime() === voice.periodEnd.getTime();
  return isSamePeriod ? {} : { periodStart: period.periodStart, periodEnd: period.periodEnd };
}

/** Si el plan cambió: minutos del escalón nuevo y, si el add-on está en Stripe, su precio nuevo. */
async function repriceOnPlanChange(
  input: VoiceAddonSyncInput,
  voice: BillingVoiceSubscription,
): Promise<BillingVoiceSubscriptionChanges> {
  const { transaction, gateway, centerBeforeEvent, event } = input;
  const newPlanId = event.planId;
  if (newPlanId === null || newPlanId === centerBeforeEvent.planId) return {};
  const tier = await transaction.findVoiceAddonTier(newPlanId);
  if (tier === null) return {};

  const canReprice =
    voice.stripeItemId !== null &&
    voice.stripeOverageItemId !== null &&
    tier.monthlyPriceId !== null &&
    tier.overagePriceId !== null;
  if (canReprice) {
    await gateway.changeVoiceAddonTier({
      itemId: voice.stripeItemId,
      overageItemId: voice.stripeOverageItemId,
      monthlyPriceId: tier.monthlyPriceId,
      overagePriceId: tier.overagePriceId,
    });
  }
  await transaction.writeAudit({
    centerId: centerBeforeEvent.id,
    action: 'voice_addon_tier_changed',
    details: {
      from: centerBeforeEvent.planId,
      to: newPlanId,
      includedMinutes: tier.includedMinutes,
      repricedInStripe: canReprice,
    },
  });
  return { includedMinutes: tier.includedMinutes };
}

type CheckoutCompletedEvent = Extract<BillingEvent, { type: 'checkout_completed' }>;

/**
 * Quien paga en la página de Stripe puede añadir el Contestador IA como línea opcional. Si la suscripción
 * recién creada la trae, se completa el add-on: se añade la línea de exceso medido (que no puede ser
 * opcional) y se da de alta el add-on del centro con los minutos de su plan.
 *
 * El número puente lo asigna después la plataforma: hasta entonces el bot sigue apagado. Repetir el aviso no
 * duplica nada: `attachVoiceAddon` reutiliza las líneas que ya están y el alta se guarda con un `upsert`.
 */
export async function activateVoiceAddonChosenAtCheckout(
  context: { readonly transaction: BillingTransaction; readonly gateway: BillingGateway },
  event: CheckoutCompletedEvent,
): Promise<void> {
  const { transaction, gateway } = context;
  // Las líneas del add-on son mensuales: en un pago anual nunca se ofrece.
  if (event.period !== 'monthly') return;
  if (!(await gateway.hasVoiceAddonLine(event.subscriptionId))) return;

  const [tier, taxRateId] = await Promise.all([
    transaction.findVoiceAddonTier(event.planId),
    transaction.findPlanTaxRateId(event.planId),
  ]);
  if (tier?.monthlyPriceId == null || tier.overagePriceId == null || taxRateId === null) return;

  const attachment = await gateway.attachVoiceAddon({
    subscriptionId: event.subscriptionId,
    monthlyPriceId: tier.monthlyPriceId,
    overagePriceId: tier.overagePriceId,
    taxRateId,
  });
  await transaction.saveChosenVoiceSubscription(event.centerId, {
    includedMinutes: tier.includedMinutes,
    periodStart: attachment.periodStart,
    periodEnd: attachment.periodEnd,
    stripeItemId: attachment.itemId,
    stripeOverageItemId: attachment.overageItemId,
  });
  await transaction.writeAudit({
    centerId: event.centerId,
    action: 'voice_addon_chosen_at_checkout',
    details: { planId: event.planId, includedMinutes: tier.includedMinutes },
  });
}
