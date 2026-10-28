import { type SubscriptionStatus } from '../../domain/subscription-rules';

export const BILLING_GATEWAY = Symbol('BILLING_GATEWAY');

export type BillingPeriod = 'monthly' | 'annual';

/** Lo que Yoclick cobra por un plan, tal y como está en `platform_plans` (céntimos, sin IVA). */
export interface PlanPriceSpec {
  readonly planId: string;
  readonly name: string;
  readonly monthlyPriceCents: number;
  /** Precio por mes pagando el año entero; el cargo anual es este importe por doce. */
  readonly annualMonthlyPriceCents: number;
  readonly setupFeeCents: number;
}

/** Los ids que Stripe asigna a un plan: producto, precios (mensual, anual, cuota de alta) e IVA. */
export interface SyncedPlan {
  readonly planId: string;
  readonly productId: string;
  readonly monthlyPriceId: string;
  readonly annualPriceId: string;
  readonly setupFeePriceId: string | null;
  readonly taxRateId: string;
}

export interface CheckoutRequest {
  readonly customerId: string;
  readonly centerId: string;
  readonly planId: string;
  readonly period: BillingPeriod;
  readonly priceId: string;
  readonly setupFeePriceId: string | null;
  readonly taxRateId: string;
  /** Si se da, el primer cobro se aplaza hasta ese día (el fin de la prueba gratuita). */
  readonly firstChargeAt: Date | null;
}

/** Un aviso de Stripe ya verificado y reducido a lo que importa para el cobro de los planes. */
export type BillingEvent =
  | {
      readonly type: 'checkout_completed';
      readonly eventId: string;
      readonly centerId: string;
      readonly planId: string;
      readonly period: BillingPeriod;
      readonly customerId: string;
      readonly subscriptionId: string;
    }
  | {
      readonly type: 'subscription_changed';
      readonly eventId: string;
      readonly customerId: string;
      readonly subscriptionId: string;
      readonly status: SubscriptionStatus;
      /** El plan y la periodicidad que la suscripción tiene ahora (cambian desde el portal); `null` si no se sabe. */
      readonly planId: string | null;
      readonly period: BillingPeriod | null;
    }
  | {
      readonly type: 'invoice_paid';
      readonly eventId: string;
      readonly customerId: string;
      readonly invoiceId: string;
      readonly invoiceNumber: string | null;
      readonly baseCents: number;
      readonly vatCents: number;
      readonly totalCents: number;
      readonly paidAt: Date;
      readonly description: string;
    }
  | { readonly type: 'payment_failed'; readonly eventId: string; readonly customerId: string };

/** `isSignatureValid: false` es un aviso falso o muy antiguo; `event: null`, un aviso que no nos interesa. */
export type BillingWebhookResult =
  | { readonly isSignatureValid: false }
  | { readonly isSignatureValid: true; readonly event: BillingEvent | null };

/** Stripe Billing: la suscripción con la que Yoclick cobra el plan a cada centro (docs/spec/17). */
export interface BillingGateway {
  /** Crea o reutiliza el producto, los precios y el IVA de cada plan; repetirlo no duplica nada. */
  syncPlans(plans: readonly PlanPriceSpec[]): Promise<SyncedPlan[]>;
  createCustomer(input: {
    centerId: string;
    name: string;
    email: string | null;
  }): Promise<{ customerId: string }>;
  /** Página de pago de Stripe a la que el propietario llega desde el navegador, nunca desde la app. */
  createCheckoutSession(input: CheckoutRequest): Promise<{ url: string }>;
  /** Qué puede hacer el cliente en su portal: cambiar entre estos planes, la tarjeta, las facturas y cancelar. */
  configurePortal(plans: readonly SyncedPlan[]): Promise<void>;
  /** Portal de Stripe donde el propietario gestiona su suscripción; el enlace es de un solo uso. */
  createPortalSession(input: { customerId: string }): Promise<{ url: string }>;
  /**
   * Cancela la suscripción de inmediato (al cerrar el centro). Si Stripe ya no la tiene o ya estaba cancelada, no
   * es un fallo: lo que se quiere es que no se vuelva a cobrar.
   */
  cancelSubscription(subscriptionId: string): Promise<void>;
  verifyWebhook(input: {
    rawBody: Buffer;
    signatureHeader: string | undefined;
    now: Date;
  }): BillingWebhookResult;
}
