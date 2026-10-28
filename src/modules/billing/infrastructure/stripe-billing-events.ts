import { z } from 'zod';
import {
  type BillingEvent,
  type BillingPeriod,
  type VoiceAddonSubscriptionFacts,
} from '../application/ports/billing-gateway';
import { type SubscriptionStatus } from '../domain/subscription-rules';
import { VOICE_ADDON_PRODUCT_ID } from '../domain/voice-addon-catalog';

const MILLISECONDS_PER_SECOND = 1000;

const SUBSCRIPTION_STATUSES = [
  'trialing',
  'active',
  'past_due',
  'unpaid',
  'canceled',
  'incomplete',
  'incomplete_expired',
  'paused',
] as const;

const periodSchema = z.enum(['monthly', 'annual']);

const envelopeSchema = z.object({
  id: z.string(),
  type: z.string(),
  /** Presente en los eventos Connect (cobros de bonos de un centro): no son del cobro del plan. */
  account: z.string().optional(),
  data: z.object({ object: z.record(z.string(), z.unknown()) }),
});

const checkoutSchema = z.object({
  customer: z.string(),
  subscription: z.string(),
  metadata: z.object({ centerId: z.uuid(), planId: z.string(), period: periodSchema }),
});

const PLAN_PRODUCT_PREFIX = 'yoclick_plan_';
const PLAN_IDS = ['basic', 'pro', 'premium'];
const INTERVAL_TO_PERIOD: Readonly<Record<string, BillingPeriod>> = {
  month: 'monthly',
  year: 'annual',
};

// El periodo de cobro va en la suscripción o, en las versiones nuevas de la API de Stripe, en cada línea.
const periodSecondsSchema = {
  current_period_start: z.number().int().optional(),
  current_period_end: z.number().int().optional(),
};

const subscriptionSchema = z.object({
  id: z.string(),
  customer: z.string(),
  status: z.enum(SUBSCRIPTION_STATUSES),
  ...periodSecondsSchema,
  items: z
    .object({
      data: z.array(
        z.object({
          ...periodSecondsSchema,
          price: z.object({
            product: z.string(),
            recurring: z.object({ interval: z.string() }).nullish(),
          }),
        }),
      ),
    })
    .optional(),
});

/** El plan y la periodicidad que marcan los productos de nuestro catálogo en la suscripción. */
function readSubscribedPlan(items: z.infer<typeof subscriptionSchema>['items']): {
  planId: string | null;
  period: BillingPeriod | null;
} {
  const planItem = items?.data.find((item) => item.price.product.startsWith(PLAN_PRODUCT_PREFIX));
  if (planItem === undefined) return { planId: null, period: null };
  const planId = planItem.price.product.slice(PLAN_PRODUCT_PREFIX.length);
  const interval = planItem.price.recurring?.interval;
  return {
    planId: PLAN_IDS.includes(planId) ? planId : null,
    period: INTERVAL_TO_PERIOD[interval ?? ''] ?? null,
  };
}

/** Si el add-on del Contestador IA sigue en la suscripción y en qué periodo de cobro está. */
function readVoiceAddon(
  subscription: z.infer<typeof subscriptionSchema>,
): VoiceAddonSubscriptionFacts | null {
  if (subscription.items === undefined) return null;
  const addonItem = subscription.items.data.find(
    (item) => item.price.product === VOICE_ADDON_PRODUCT_ID,
  );
  if (addonItem === undefined) return { isPresent: false, periodStart: null, periodEnd: null };
  const startSeconds = subscription.current_period_start ?? addonItem.current_period_start;
  const endSeconds = subscription.current_period_end ?? addonItem.current_period_end;
  const hasPeriod = startSeconds !== undefined && endSeconds !== undefined;
  return {
    isPresent: true,
    periodStart: hasPeriod ? new Date(startSeconds * MILLISECONDS_PER_SECOND) : null,
    periodEnd: hasPeriod ? new Date(endSeconds * MILLISECONDS_PER_SECOND) : null,
  };
}

const invoiceSchema = z.object({
  id: z.string(),
  customer: z.string(),
  number: z.string().nullish(),
  total: z.number().int(),
  subtotal: z.number().int(),
  total_excluding_tax: z.number().int().nullish(),
  description: z.string().nullish(),
  status_transitions: z.object({ paid_at: z.number().int().nullish() }).optional(),
  created: z.number().int(),
});

const failedInvoiceSchema = z.object({ customer: z.string() });

function toCheckoutCompleted(eventId: string, object: unknown): BillingEvent | null {
  const parsed = checkoutSchema.safeParse(object);
  if (!parsed.success) return null;
  const { customer, subscription, metadata } = parsed.data;
  return {
    type: 'checkout_completed',
    eventId,
    centerId: metadata.centerId,
    planId: metadata.planId,
    period: metadata.period satisfies BillingPeriod,
    customerId: customer,
    subscriptionId: subscription,
  };
}

function toSubscriptionChanged(
  eventId: string,
  object: unknown,
  forcedStatus?: SubscriptionStatus,
) {
  const parsed = subscriptionSchema.safeParse(object);
  if (!parsed.success) return null;
  return {
    type: 'subscription_changed' as const,
    eventId,
    customerId: parsed.data.customer,
    subscriptionId: parsed.data.id,
    status: forcedStatus ?? parsed.data.status,
    ...readSubscribedPlan(parsed.data.items),
    voiceAddon: readVoiceAddon(parsed.data),
  };
}

function toInvoicePaid(eventId: string, object: unknown): BillingEvent | null {
  const parsed = invoiceSchema.safeParse(object);
  if (!parsed.success) return null;
  const invoice = parsed.data;
  const baseCents = invoice.total_excluding_tax ?? invoice.subtotal;
  const paidAtSeconds = invoice.status_transitions?.paid_at ?? invoice.created;
  return {
    type: 'invoice_paid',
    eventId,
    customerId: invoice.customer,
    invoiceId: invoice.id,
    invoiceNumber: invoice.number ?? null,
    baseCents,
    vatCents: invoice.total - baseCents,
    totalCents: invoice.total,
    paidAt: new Date(paidAtSeconds * MILLISECONDS_PER_SECOND),
    description: invoice.description ?? '',
  };
}

function toPaymentFailed(eventId: string, object: unknown): BillingEvent | null {
  const parsed = failedInvoiceSchema.safeParse(object);
  return parsed.success
    ? { type: 'payment_failed', eventId, customerId: parsed.data.customer }
    : null;
}

/**
 * Reduce un aviso de Stripe a lo que importa para el cobro del plan. Todo lo demás (cobros de bonos,
 * avisos de otros objetos, formas inesperadas) devuelve `null` y se ignora.
 */
export function parseBillingEvent(rawBody: string): BillingEvent | null {
  const envelope = envelopeSchema.safeParse(JSON.parse(rawBody));
  if (!envelope.success || envelope.data.account !== undefined) return null;
  const { id, type, data: eventData } = envelope.data;
  switch (type) {
    case 'checkout.session.completed':
      return toCheckoutCompleted(id, eventData.object);
    case 'customer.subscription.updated':
      return toSubscriptionChanged(id, eventData.object);
    case 'customer.subscription.deleted':
      return toSubscriptionChanged(id, eventData.object, 'canceled');
    case 'invoice.paid':
      return toInvoicePaid(id, eventData.object);
    case 'invoice.payment_failed':
      return toPaymentFailed(id, eventData.object);
    default:
      return null;
  }
}
