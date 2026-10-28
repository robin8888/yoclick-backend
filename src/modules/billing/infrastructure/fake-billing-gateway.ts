import {
  type BillingEvent,
  type BillingGateway,
  type BillingWebhookResult,
  type CheckoutRequest,
  type PlanPriceSpec,
  type SyncedPlan,
  type SyncedVoiceAddonPlan,
  type VoiceAddonAttachment,
  type VoiceAddonPriceSpec,
} from '../application/ports/billing-gateway';
import { addMonthsToInstant } from '../../../shared/time/add-months';

const FAKE_SIGNATURE = 'fake-signature';

/** El JSON de un aviso de prueba lleva los periodos del add-on como texto. */
function reviveVoiceAddonDates(voiceAddon: unknown): unknown {
  if (voiceAddon === null || typeof voiceAddon !== 'object') return voiceAddon;
  const { periodStart, periodEnd, ...rest } = voiceAddon as Record<string, unknown>;
  return {
    ...rest,
    periodStart: typeof periodStart === 'string' ? new Date(periodStart) : null,
    periodEnd: typeof periodEnd === 'string' ? new Date(periodEnd) : null,
  };
}

/**
 * La pasarela de cobro de planes sin Stripe, para desarrollo y tests (`PAYMENT_PROVIDER=fake`). Un aviso de
 * prueba es válido si lleva la firma `fake-signature` y un cuerpo `{ "billingEvent": { ... } }`.
 */
export class FakeBillingGateway implements BillingGateway {
  readonly checkoutRequests: CheckoutRequest[] = [];

  syncPlans(plans: readonly PlanPriceSpec[]): Promise<SyncedPlan[]> {
    return Promise.resolve(
      plans.map((plan) => ({
        planId: plan.planId,
        productId: `prod_fake_${plan.planId}`,
        monthlyPriceId: `price_fake_${plan.planId}_monthly`,
        annualPriceId: `price_fake_${plan.planId}_annual`,
        setupFeePriceId: plan.setupFeeCents === 0 ? null : `price_fake_${plan.planId}_setup`,
        taxRateId: 'txr_fake_vat',
      })),
    );
  }

  createCustomer(input: { centerId: string }): Promise<{ customerId: string }> {
    return Promise.resolve({ customerId: `cus_fake_${input.centerId}` });
  }

  createCheckoutSession(input: CheckoutRequest): Promise<{ url: string }> {
    this.checkoutRequests.push(input);
    return Promise.resolve({ url: `https://checkout.fake.test/pay/${input.centerId}` });
  }

  readonly cancelledSubscriptionIds: string[] = [];
  readonly portalCustomerIds: string[] = [];
  portalConfigurations = 0;

  configurePortal(): Promise<void> {
    this.portalConfigurations += 1;
    return Promise.resolve();
  }

  createPortalSession(input: { customerId: string }): Promise<{ url: string }> {
    this.portalCustomerIds.push(input.customerId);
    return Promise.resolve({ url: `https://billing.fake.test/portal/${input.customerId}` });
  }

  cancelSubscription(subscriptionId: string): Promise<void> {
    this.cancelledSubscriptionIds.push(subscriptionId);
    return Promise.resolve();
  }

  /** Lo que el add-on del Contestador IA ha pedido a Stripe, para que los tests lo comprueben. */
  readonly attachedVoiceSubscriptionIds: string[] = [];
  readonly voiceTierChanges: { itemId: string; monthlyPriceId: string }[] = [];
  readonly detachedVoiceItemIds: string[] = [];
  readonly reportedVoiceOverages: {
    customerId: string;
    minutes: number;
    identifier: string;
    occurredAt: Date;
  }[] = [];
  /** Con `true`, comunicar el exceso falla como si Stripe estuviera caído. */
  isVoiceOverageReportFailing = false;
  /** El periodo de cobro que la pasarela dice al añadir el add-on; sin él, un mes desde ahora. */
  voiceBillingPeriod: { periodStart: Date; periodEnd: Date } | null = null;

  syncVoiceAddon(specs: readonly VoiceAddonPriceSpec[]): Promise<SyncedVoiceAddonPlan[]> {
    return Promise.resolve(
      specs.map((spec) => ({
        planId: spec.planId,
        monthlyPriceId: `price_fake_voice_${spec.planId}_monthly`,
        overagePriceId: `price_fake_voice_${spec.planId}_overage`,
      })),
    );
  }

  attachVoiceAddon(input: { subscriptionId: string }): Promise<VoiceAddonAttachment> {
    this.attachedVoiceSubscriptionIds.push(input.subscriptionId);
    const now = new Date();
    return Promise.resolve({
      itemId: `si_fake_voice_${input.subscriptionId}`,
      overageItemId: `si_fake_voice_overage_${input.subscriptionId}`,
      ...(this.voiceBillingPeriod ?? { periodStart: now, periodEnd: addMonthsToInstant(now, 1) }),
    });
  }

  /** Las suscripciones cuya página de pago se pagó con el add-on elegido: lo decide cada test. */
  readonly subscriptionIdsWithVoiceAddonLine = new Set<string>();

  hasVoiceAddonLine(subscriptionId: string): Promise<boolean> {
    return Promise.resolve(this.subscriptionIdsWithVoiceAddonLine.has(subscriptionId));
  }

  changeVoiceAddonTier(input: { itemId: string; monthlyPriceId: string }): Promise<void> {
    this.voiceTierChanges.push({ itemId: input.itemId, monthlyPriceId: input.monthlyPriceId });
    return Promise.resolve();
  }

  detachVoiceAddon(input: { itemId: string }): Promise<void> {
    this.detachedVoiceItemIds.push(input.itemId);
    return Promise.resolve();
  }

  /** Como Stripe: un `identifier` repetido se descarta sin sumar de nuevo. */
  reportVoiceOverage(input: {
    customerId: string;
    minutes: number;
    identifier: string;
    occurredAt: Date;
  }): Promise<void> {
    if (this.isVoiceOverageReportFailing) {
      return Promise.reject(new Error('Stripe is down (fake)'));
    }
    const isAlreadyReported = this.reportedVoiceOverages.some(
      (reported) => reported.identifier === input.identifier,
    );
    if (!isAlreadyReported) this.reportedVoiceOverages.push(input);
    return Promise.resolve();
  }

  verifyWebhook(input: {
    rawBody: Buffer;
    signatureHeader: string | undefined;
  }): BillingWebhookResult {
    if (input.signatureHeader !== FAKE_SIGNATURE) return { isSignatureValid: false };
    const body = JSON.parse(input.rawBody.toString('utf8')) as {
      billingEvent?: Record<string, unknown>;
    };
    if (body.billingEvent === undefined) return { isSignatureValid: true, event: null };
    // El JSON lleva la fecha como texto; el aviso de Stripe ya verificado la lleva como fecha.
    const { paidAt, voiceAddon, ...rest } = body.billingEvent;
    const withDates = {
      ...rest,
      ...(typeof paidAt === 'string' ? { paidAt: new Date(paidAt) } : {}),
      ...(voiceAddon === undefined ? {} : { voiceAddon: reviveVoiceAddonDates(voiceAddon) }),
    };
    return { isSignatureValid: true, event: withDates as BillingEvent };
  }
}
