import {
  type BillingEvent,
  type BillingGateway,
  type BillingWebhookResult,
  type CheckoutRequest,
  type PlanPriceSpec,
  type SyncedPlan,
} from '../application/ports/billing-gateway';

const FAKE_SIGNATURE = 'fake-signature';

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
    const { paidAt, ...rest } = body.billingEvent;
    const event = (
      typeof paidAt === 'string' ? { ...rest, paidAt: new Date(paidAt) } : rest
    ) as BillingEvent;
    return { isSignatureValid: true, event };
  }
}
