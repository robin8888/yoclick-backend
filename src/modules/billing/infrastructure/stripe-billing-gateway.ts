import { z } from 'zod';
import {
  MILLISECONDS_PER_DAY,
  MILLISECONDS_PER_HOUR,
  MILLISECONDS_PER_SECOND,
} from '../../../shared/time/time-units';
import { isValidStripeSignature } from '../../payments/infrastructure/stripe-signature';
import {
  type BillingGateway,
  type BillingWebhookResult,
  type CheckoutRequest,
  type PlanPriceSpec,
  type SyncedPlan,
} from '../application/ports/billing-gateway';
import { parseBillingEvent } from './stripe-billing-events';
import { StripeHttpClient, StripeRequestError } from './stripe-http-client';

const CURRENCY = 'eur';
const MONTHS_PER_YEAR = 12;
const VAT_BASIS_POINTS = 2100;
const VAT_PERCENTAGE = '21';
const VAT_TAG = 'yoclick_vat';
const LIST_LIMIT = '100';
/** Stripe Checkout no admite aplazar el primer cobro menos de 48 horas; una hora más de margen. */
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
const PORTAL_TAG = 'yoclick_portal';
const PORTAL_TAG_VALUE = 'plans';

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

  private async ensureProduct(plan: PlanPriceSpec): Promise<string> {
    const productId = `yoclick_plan_${plan.planId}`;
    try {
      await this.stripe.get(`/products/${productId}`, idSchema);
      return productId;
    } catch (error) {
      if (!(error instanceof StripeRequestError) || !error.isMissingResource) throw error;
    }
    const created = await this.stripe.post({
      path: '/products',
      schema: idSchema,
      fields: { id: productId, name: `Yoclick ${plan.name}`, 'metadata[planId]': plan.planId },
    });
    return created.id;
  }

  /** Un precio de Stripe no se puede cambiar: el importe va en su clave y, si cambia, nace otro precio. */
  private async ensurePrice(input: {
    lookupKey: string;
    productId: string;
    amountCents: number;
    interval: 'month' | 'year' | null;
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
      ...this.buildTrialField(input.firstChargeAt),
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

  /**
   * Deja el portal con lo que importa: cambiar entre nuestros planes (mensual o anual, con prorrateo),
   * cambiar la tarjeta, ver las facturas y cancelar al final del periodo. Se recrea sin duplicar.
   */
  async configurePortal(plans: readonly SyncedPlan[]): Promise<void> {
    const existingId = await this.findPortalConfigurationId();
    await this.stripe.post({
      path:
        existingId === null
          ? '/billing_portal/configurations'
          : `/billing_portal/configurations/${existingId}`,
      schema: idSchema,
      fields: this.buildPortalFields(plans),
    });
  }

  private buildPortalFields(plans: readonly SyncedPlan[]): Record<string, string> {
    const productFields = plans.flatMap((plan, index): [string, string][] => {
      const prefix = `features[subscription_update][products][${String(index)}]`;
      return [
        [`${prefix}[product]`, plan.productId],
        [`${prefix}[prices][0]`, plan.monthlyPriceId],
        [`${prefix}[prices][1]`, plan.annualPriceId],
      ];
    });
    return {
      [`metadata[${PORTAL_TAG}]`]: PORTAL_TAG_VALUE,
      'business_profile[headline]': 'Gestiona tu suscripción de Yoclick',
      default_return_url: this.config.portalReturnUrl,
      'features[subscription_update][enabled]': 'true',
      'features[subscription_update][default_allowed_updates][0]': 'price',
      'features[subscription_update][proration_behavior]': 'create_prorations',
      'features[payment_method_update][enabled]': 'true',
      'features[invoice_history][enabled]': 'true',
      'features[subscription_cancel][enabled]': 'true',
      'features[subscription_cancel][mode]': 'at_period_end',
      ...Object.fromEntries(productFields),
    };
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
