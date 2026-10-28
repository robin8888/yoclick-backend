import { z } from 'zod';
import {
  MILLISECONDS_PER_DAY,
  MILLISECONDS_PER_HOUR,
  MILLISECONDS_PER_SECOND,
} from '../../../shared/time/time-units';
import { addMonthsToInstant } from '../../../shared/time/add-months';
import { isValidStripeSignature } from '../../payments/infrastructure/stripe-signature';
import {
  type BillingGateway,
  type BillingWebhookResult,
  type CheckoutRequest,
  type PlanPriceSpec,
  type SyncedPlan,
  type SyncedVoiceAddonPlan,
  type VoiceAddonAttachment,
  type VoiceAddonPriceSpec,
} from '../application/ports/billing-gateway';
import { VOICE_ADDON_PRODUCT_ID, VOICE_METER_EVENT_NAME } from '../domain/voice-addon-catalog';
import { parseBillingEvent } from './stripe-billing-events';
import { StripeHttpClient, StripeRequestError } from './stripe-http-client';

const CURRENCY = 'eur';
const MONTHS_PER_YEAR = 12;
const VAT_BASIS_POINTS = 2100;
const VAT_PERCENTAGE = '21';
const VAT_TAG = 'yoclick_vat';
const LIST_LIMIT = '100';
/** Stripe Checkout no admite aplazar el primer cobro menos de 48 horas; una hora más de margen. */
/** La primera versión de la API de Stripe con `optional_items` en las páginas de pago. */
const OPTIONAL_ITEMS_API_VERSION = '2025-03-31.basil';
const MIN_TRIAL_DAYS = 2;
const MIN_TRIAL_END_MS = MIN_TRIAL_DAYS * MILLISECONDS_PER_DAY + MILLISECONDS_PER_HOUR;

export interface StripeBillingConfig {
  readonly secretKey: string;
  readonly webhookSecrets: readonly string[];
  readonly successUrl: string;
  readonly cancelUrl: string;
  /** A dónde vuelve el navegador al salir del portal de cliente. */
  readonly portalReturnUrl: string;
}

const idSchema = z.object({ id: z.string() });
const listSchema = z.object({
  data: z.array(
    z.object({ id: z.string(), metadata: z.record(z.string(), z.string()).default({}) }),
  ),
});
const sessionSchema = z.object({ url: z.url() });
const meterListSchema = z.object({
  data: z.array(z.object({ id: z.string(), event_name: z.string() })),
});
const anyObjectSchema = z.looseObject({});
const periodFieldsSchema = {
  current_period_start: z.number().int().optional(),
  current_period_end: z.number().int().optional(),
};
/** La suscripción con sus líneas: de ahí se sabe qué parte del add-on ya está puesta y en qué periodo está. */
const subscriptionWithItemsSchema = z.object({
  id: z.string(),
  ...periodFieldsSchema,
  items: z.object({
    data: z.array(
      z.object({
        id: z.string(),
        ...periodFieldsSchema,
        price: z.object({
          id: z.string(),
          product: z.string(),
          recurring: z.object({ usage_type: z.string().optional() }).nullish(),
        }),
      }),
    ),
  }),
});
type SubscriptionWithItems = z.infer<typeof subscriptionWithItemsSchema>;
const PORTAL_TAG = 'yoclick_portal';
const PORTAL_TAG_VALUE = 'plans';

/**
 * Cambios de plan que Stripe aplica al terminar el periodo ya pagado y no al momento: bajar a un plan más
 * barato y pasar de anual a mensual. Se entrega lo que se cobró hasta su último día (consumo) y no hay
 * reembolsos a medias. Subir de plan sigue siendo inmediato, con prorrateo.
 */
const DEFERRED_UPDATE_CONDITIONS = ['decreasing_item_amount', 'shortening_interval'] as const;

/**
 * Los campos del portal de cliente: cambiar entre nuestros planes (mensual o anual), cambiar la tarjeta,
 * ver las facturas y cancelar al final del periodo. El portal ya creado no se entera solo: tras cambiar
 * esto hay que volver a ejecutar `npm run billing:setup`.
 */
export function buildPortalFields(input: {
  plans: readonly SyncedPlan[];
  returnUrl: string;
}): Record<string, string> {
  const productFields = input.plans.flatMap((plan, index): [string, string][] => {
    const prefix = `features[subscription_update][products][${String(index)}]`;
    return [
      [`${prefix}[product]`, plan.productId],
      [`${prefix}[prices][0]`, plan.monthlyPriceId],
      [`${prefix}[prices][1]`, plan.annualPriceId],
    ];
  });
  const deferredFields = DEFERRED_UPDATE_CONDITIONS.map((condition, index): [string, string] => [
    `features[subscription_update][schedule_at_period_end][conditions][${String(index)}][type]`,
    condition,
  ]);
  return {
    [`metadata[${PORTAL_TAG}]`]: PORTAL_TAG_VALUE,
    'business_profile[headline]': 'Gestiona tu suscripción de Yoclick',
    default_return_url: input.returnUrl,
    'features[subscription_update][enabled]': 'true',
    'features[subscription_update][default_allowed_updates][0]': 'price',
    'features[subscription_update][proration_behavior]': 'create_prorations',
    'features[payment_method_update][enabled]': 'true',
    'features[invoice_history][enabled]': 'true',
    'features[subscription_cancel][enabled]': 'true',
    'features[subscription_cancel][mode]': 'at_period_end',
    ...Object.fromEntries(deferredFields),
    ...Object.fromEntries(productFields),
  };
}

/** Stripe Billing sobre su API HTTP: productos, precios, clientes y páginas de pago de los planes. */
export class StripeBillingGateway implements BillingGateway {
  private readonly stripe: StripeHttpClient;

  constructor(private readonly config: StripeBillingConfig) {
    this.stripe = new StripeHttpClient(config.secretKey);
  }

  async syncPlans(plans: readonly PlanPriceSpec[]): Promise<SyncedPlan[]> {
    const taxRateId = await this.ensureVatTaxRate();
    const synced: SyncedPlan[] = [];
    for (const plan of plans) {
      const productId = await this.ensureProduct(plan);
      synced.push({
        planId: plan.planId,
        productId,
        monthlyPriceId: await this.ensureRecurringPrice(plan, 'monthly', productId),
        annualPriceId: await this.ensureRecurringPrice(plan, 'annual', productId),
        setupFeePriceId: await this.ensureSetupFeePrice(plan, productId),
        taxRateId,
      });
    }
    return synced;
  }

  /** El IVA del 21 % se crea una vez y se reconoce por su etiqueta, no por su nombre. */
  private async ensureVatTaxRate(): Promise<string> {
    const existing = await this.stripe.get(
      `/tax_rates?active=true&limit=${LIST_LIMIT}`,
      listSchema,
    );
    const found = existing.data.find((rate) => rate.metadata[VAT_TAG] === String(VAT_BASIS_POINTS));
    if (found !== undefined) return found.id;
    const created = await this.stripe.post({
      path: '/tax_rates',
      schema: idSchema,
      fields: {
        display_name: 'IVA',
        percentage: VAT_PERCENTAGE,
        inclusive: 'false',
        country: 'ES',
        tax_type: 'vat',
        [`metadata[${VAT_TAG}]`]: String(VAT_BASIS_POINTS),
      },
    });
    return created.id;
  }

  private ensureProduct(plan: PlanPriceSpec): Promise<string> {
    return this.ensureProductWithId({
      productId: `yoclick_plan_${plan.planId}`,
      name: `Yoclick ${plan.name}`,
      metadata: { planId: plan.planId },
    });
  }

  private async ensureProductWithId(input: {
    productId: string;
    name: string;
    metadata: Readonly<Record<string, string>>;
  }): Promise<string> {
    const { productId } = input;
    try {
      await this.stripe.get(`/products/${productId}`, idSchema);
      return productId;
    } catch (error) {
      if (!(error instanceof StripeRequestError) || !error.isMissingResource) throw error;
    }
    const created = await this.stripe.post({
      path: '/products',
      schema: idSchema,
      fields: {
        id: productId,
        name: input.name,
        ...Object.fromEntries(
          Object.entries(input.metadata).map(([key, value]) => [`metadata[${key}]`, value]),
        ),
      },
    });
    return created.id;
  }

  /** Un precio de Stripe no se puede cambiar: el importe va en su clave y, si cambia, nace otro precio. */
  private async ensurePrice(input: {
    lookupKey: string;
    productId: string;
    amountCents: number;
    interval: 'month' | 'year' | null;
    /** Campos propios de un precio medido (medidor y tipo de uso). */
    extraFields?: Readonly<Record<string, string>>;
  }): Promise<string> {
    const found = await this.stripe.get(
      `/prices?active=true&lookup_keys[]=${input.lookupKey}`,
      listSchema,
    );
    const existingId = found.data[0]?.id;
    if (existingId !== undefined) return existingId;
    const created = await this.stripe.post({
      path: '/prices',
      schema: idSchema,
      fields: {
        product: input.productId,
        currency: CURRENCY,
        unit_amount: String(input.amountCents),
        lookup_key: input.lookupKey,
        transfer_lookup_key: 'true',
        tax_behavior: 'exclusive',
        ...(input.interval === null ? {} : { 'recurring[interval]': input.interval }),
        ...input.extraFields,
      },
    });
    return created.id;
  }

  private ensureRecurringPrice(
    plan: PlanPriceSpec,
    period: 'monthly' | 'annual',
    productId: string,
  ): Promise<string> {
    const isAnnual = period === 'annual';
    const amountCents = isAnnual
      ? plan.annualMonthlyPriceCents * MONTHS_PER_YEAR
      : plan.monthlyPriceCents;
    return this.ensurePrice({
      lookupKey: `yoclick_${plan.planId}_${period}_${String(amountCents)}`,
      productId,
      amountCents,
      interval: isAnnual ? 'year' : 'month',
    });
  }

  private async ensureSetupFeePrice(
    plan: PlanPriceSpec,
    productId: string,
  ): Promise<string | null> {
    if (plan.setupFeeCents === 0) return null;
    return this.ensurePrice({
      lookupKey: `yoclick_${plan.planId}_setup_${String(plan.setupFeeCents)}`,
      productId,
      amountCents: plan.setupFeeCents,
      interval: null,
    });
  }

  async createCustomer(input: {
    centerId: string;
    name: string;
    email: string | null;
  }): Promise<{ customerId: string }> {
    const customer = await this.stripe.post({
      path: '/customers',
      schema: idSchema,
      idempotencyKey: `yoclick-customer-${input.centerId}`,
      fields: {
        name: input.name,
        'metadata[centerId]': input.centerId,
        ...(input.email === null ? {} : { email: input.email }),
      },
    });
    return { customerId: customer.id };
  }

  async createCheckoutSession(input: CheckoutRequest): Promise<{ url: string }> {
    const session = await this.stripe.post({
      path: '/checkout/sessions',
      schema: sessionSchema,
      fields: this.buildCheckoutFields(input),
      // `optional_items` existe desde 2025-03-31.basil: se fija para no depender de la versión de la cuenta.
      ...(input.voiceAddonPriceId === null ? {} : { apiVersion: OPTIONAL_ITEMS_API_VERSION }),
    });
    return { url: session.url };
  }

  private buildCheckoutFields(input: CheckoutRequest): Record<string, string> {
    const lines = [
      input.priceId,
      ...(input.setupFeePriceId === null ? [] : [input.setupFeePriceId]),
    ];
    const metadata = { centerId: input.centerId, planId: input.planId, period: input.period };
    return {
      mode: 'subscription',
      customer: input.customerId,
      client_reference_id: input.centerId,
      locale: 'es',
      success_url: this.config.successUrl,
      cancel_url: this.config.cancelUrl,
      ...Object.fromEntries(
        lines.flatMap((priceId, index) => [
          [`line_items[${String(index)}][price]`, priceId],
          [`line_items[${String(index)}][quantity]`, '1'],
          [`line_items[${String(index)}][tax_rates][0]`, input.taxRateId],
        ]),
      ),
      ...Object.fromEntries(
        Object.entries(metadata).flatMap(([key, value]) => [
          [`metadata[${key}]`, value],
          [`subscription_data[metadata][${key}]`, value],
        ]),
      ),
      ...this.buildVoiceAddonOption(input),
      ...this.buildTrialField(input.firstChargeAt),
    };
  }

  /**
   * El add-on como línea opcional de la página de pago. Las líneas opcionales no llevan IVA propio, así que el
   * de la suscripción se pone como IVA por defecto de las líneas que no lo traen.
   */
  private buildVoiceAddonOption(input: CheckoutRequest): Record<string, string> {
    if (input.voiceAddonPriceId === null) return {};
    return {
      'optional_items[0][price]': input.voiceAddonPriceId,
      'optional_items[0][quantity]': '1',
      'subscription_data[default_tax_rates][0]': input.taxRateId,
    };
  }

  private buildTrialField(firstChargeAt: Date | null): Record<string, string> {
    if (firstChargeAt === null) return {};
    if (firstChargeAt.getTime() - Date.now() < MIN_TRIAL_END_MS) return {};
    return {
      'subscription_data[trial_end]': String(
        Math.floor(firstChargeAt.getTime() / MILLISECONDS_PER_SECOND),
      ),
    };
  }

  /** Deja el portal como dice `buildPortalFields`. Se recrea sin duplicar. */
  async configurePortal(plans: readonly SyncedPlan[]): Promise<void> {
    const existingId = await this.findPortalConfigurationId();
    await this.stripe.post({
      path:
        existingId === null
          ? '/billing_portal/configurations'
          : `/billing_portal/configurations/${existingId}`,
      schema: idSchema,
      fields: buildPortalFields({ plans, returnUrl: this.config.portalReturnUrl }),
    });
  }

  private async findPortalConfigurationId(): Promise<string | null> {
    const configurations = await this.stripe.get(
      `/billing_portal/configurations?active=true&limit=${LIST_LIMIT}`,
      listSchema,
    );
    const ours = configurations.data.find(
      (configuration) => configuration.metadata[PORTAL_TAG] === PORTAL_TAG_VALUE,
    );
    return ours?.id ?? null;
  }

  async createPortalSession(input: { customerId: string }): Promise<{ url: string }> {
    const configurationId = await this.findPortalConfigurationId();
    const session = await this.stripe.post({
      path: '/billing_portal/sessions',
      schema: sessionSchema,
      fields: {
        customer: input.customerId,
        return_url: this.config.portalReturnUrl,
        ...(configurationId === null ? {} : { configuration: configurationId }),
      },
    });
    return { url: session.url };
  }

  async cancelSubscription(subscriptionId: string): Promise<void> {
    try {
      await this.stripe.delete(`/subscriptions/${subscriptionId}`, idSchema);
    } catch (error) {
      // Ya no existe o ya estaba cancelada: el objetivo (que no se cobre más) está cumplido.
      if (!(error instanceof StripeRequestError) || !error.isMissingResource) throw error;
    }
  }

  async syncVoiceAddon(specs: readonly VoiceAddonPriceSpec[]): Promise<SyncedVoiceAddonPlan[]> {
    const productId = await this.ensureProductWithId({
      productId: VOICE_ADDON_PRODUCT_ID,
      name: 'Yoclick Contestador IA',
      metadata: { addon: 'voice_receptionist' },
    });
    const meterId = await this.ensureVoiceMeter();
    const synced: SyncedVoiceAddonPlan[] = [];
    for (const spec of specs) {
      synced.push({
        planId: spec.planId,
        monthlyPriceId: await this.ensurePrice({
          lookupKey: `yoclick_voice_${spec.planId}_monthly_${String(spec.monthlyPriceCents)}`,
          productId,
          amountCents: spec.monthlyPriceCents,
          interval: 'month',
        }),
        overagePriceId: await this.ensurePrice({
          lookupKey: `yoclick_voice_${spec.planId}_overage_${String(spec.overageCentsPerMinute)}`,
          productId,
          amountCents: spec.overageCentsPerMinute,
          interval: 'month',
          extraFields: {
            billing_scheme: 'per_unit',
            'recurring[usage_type]': 'metered',
            'recurring[meter]': meterId,
          },
        }),
      });
    }
    return synced;
  }

  /** Un solo medidor de minutos para toda la plataforma; se reconoce por el nombre de su evento. */
  private async ensureVoiceMeter(): Promise<string> {
    const meters = await this.stripe.get(
      `/billing/meters?status=active&limit=${LIST_LIMIT}`,
      meterListSchema,
    );
    const found = meters.data.find((meter) => meter.event_name === VOICE_METER_EVENT_NAME);
    if (found !== undefined) return found.id;
    const created = await this.stripe.post({
      path: '/billing/meters',
      schema: idSchema,
      fields: {
        display_name: 'Minutos del Contestador IA',
        event_name: VOICE_METER_EVENT_NAME,
        'default_aggregation[formula]': 'sum',
        'customer_mapping[event_payload_key]': 'stripe_customer_id',
        'customer_mapping[type]': 'by_id',
        'value_settings[event_payload_key]': 'value',
      },
    });
    return created.id;
  }

  async attachVoiceAddon(input: {
    subscriptionId: string;
    monthlyPriceId: string;
    overagePriceId: string;
    taxRateId: string;
  }): Promise<VoiceAddonAttachment> {
    const subscription = await this.stripe.get(
      `/subscriptions/${input.subscriptionId}`,
      subscriptionWithItemsSchema,
    );
    const addonItems = subscription.items.data.filter(
      (item) => item.price.product === VOICE_ADDON_PRODUCT_ID,
    );
    const fixedItemId =
      addonItems.find((item) => item.price.recurring?.usage_type !== 'metered')?.id ??
      (await this.addSubscriptionItem(input, input.monthlyPriceId, { quantity: '1' }));
    const overageItemId =
      addonItems.find((item) => item.price.recurring?.usage_type === 'metered')?.id ??
      (await this.addSubscriptionItem(input, input.overagePriceId, {}));
    return { itemId: fixedItemId, overageItemId, ...this.readBillingPeriod(subscription) };
  }

  async hasVoiceAddonLine(subscriptionId: string): Promise<boolean> {
    const subscription = await this.stripe.get(
      `/subscriptions/${subscriptionId}`,
      subscriptionWithItemsSchema,
    );
    return subscription.items.data.some(
      (item) =>
        item.price.product === VOICE_ADDON_PRODUCT_ID &&
        item.price.recurring?.usage_type !== 'metered',
    );
  }

  /** Si un corte deja la línea puesta, `attachVoiceAddon` la encuentra al reintentar y no la añade otra vez. */
  private async addSubscriptionItem(
    input: { subscriptionId: string; taxRateId: string },
    priceId: string,
    extraFields: Readonly<Record<string, string>>,
  ): Promise<string> {
    const created = await this.stripe.post({
      path: '/subscription_items',
      schema: idSchema,
      fields: {
        subscription: input.subscriptionId,
        price: priceId,
        'tax_rates[0]': input.taxRateId,
        proration_behavior: 'create_prorations',
        ...extraFields,
      },
    });
    return created.id;
  }

  /**
   * El periodo de cobro: Stripe lo da en la suscripción o, en las versiones nuevas de su API, en cada línea.
   * Si no lo trae, se supone un mes desde ahora (la renovación real llega después en un aviso).
   */
  private readBillingPeriod(subscription: SubscriptionWithItems): {
    periodStart: Date;
    periodEnd: Date;
  } {
    const firstItem = subscription.items.data[0];
    const startSeconds = subscription.current_period_start ?? firstItem?.current_period_start;
    const endSeconds = subscription.current_period_end ?? firstItem?.current_period_end;
    if (startSeconds === undefined || endSeconds === undefined) {
      const now = new Date();
      return { periodStart: now, periodEnd: addMonthsToInstant(now, 1) };
    }
    return {
      periodStart: new Date(startSeconds * MILLISECONDS_PER_SECOND),
      periodEnd: new Date(endSeconds * MILLISECONDS_PER_SECOND),
    };
  }

  async changeVoiceAddonTier(input: {
    itemId: string;
    overageItemId: string;
    monthlyPriceId: string;
    overagePriceId: string;
  }): Promise<void> {
    await this.stripe.post({
      path: `/subscription_items/${input.itemId}`,
      schema: anyObjectSchema,
      fields: { price: input.monthlyPriceId, proration_behavior: 'create_prorations' },
    });
    // El minuto de exceso no se prorratea: se factura por lo medido al cerrar el periodo.
    await this.stripe.post({
      path: `/subscription_items/${input.overageItemId}`,
      schema: anyObjectSchema,
      fields: { price: input.overagePriceId, proration_behavior: 'none' },
    });
  }

  async detachVoiceAddon(input: { itemId: string; overageItemId: string | null }): Promise<void> {
    await this.deleteSubscriptionItem(`/subscription_items/${input.itemId}`);
    if (input.overageItemId !== null) {
      await this.deleteSubscriptionItem(
        `/subscription_items/${input.overageItemId}?proration_behavior=none&clear_usage=true`,
      );
    }
  }

  private async deleteSubscriptionItem(path: string): Promise<void> {
    try {
      await this.stripe.delete(path, anyObjectSchema);
    } catch (error) {
      // Ya no existe: lo que se quiere (que no se cobre más) está cumplido.
      if (!(error instanceof StripeRequestError) || !error.isMissingResource) throw error;
    }
  }

  async reportVoiceOverage(input: {
    customerId: string;
    minutes: number;
    identifier: string;
    occurredAt: Date;
  }): Promise<void> {
    await this.stripe.post({
      path: '/billing/meter_events',
      schema: anyObjectSchema,
      idempotencyKey: input.identifier,
      fields: {
        event_name: VOICE_METER_EVENT_NAME,
        identifier: input.identifier,
        'payload[stripe_customer_id]': input.customerId,
        'payload[value]': String(input.minutes),
        timestamp: String(Math.floor(input.occurredAt.getTime() / MILLISECONDS_PER_SECOND)),
      },
    });
  }

  verifyWebhook(input: {
    rawBody: Buffer;
    signatureHeader: string | undefined;
    now: Date;
  }): BillingWebhookResult {
    const isValid = this.config.webhookSecrets.some((secret) =>
      isValidStripeSignature({
        rawBody: input.rawBody,
        signatureHeader: input.signatureHeader,
        secret,
        now: input.now,
      }),
    );
    if (!isValid) return { isSignatureValid: false };
    return { isSignatureValid: true, event: parseBillingEvent(input.rawBody.toString('utf8')) };
  }
}
