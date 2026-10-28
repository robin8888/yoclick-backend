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

/** Lo que Yoclick cobra por el add-on del Contestador IA en un escalón de plan, tal y como está en `voice_addon_plans`. */
export interface VoiceAddonPriceSpec {
  readonly planId: string;
  readonly monthlyPriceCents: number;
  readonly overageCentsPerMinute: number;
}

/** Los precios de Stripe de un escalón del add-on: la cuota fija mensual y el minuto de exceso medido. */
export interface SyncedVoiceAddonPlan {
  readonly planId: string;
  readonly monthlyPriceId: string;
  readonly overagePriceId: string;
}

/** Las dos líneas del add-on dentro de la suscripción del centro y el periodo de cobro en el que están. */
export interface VoiceAddonAttachment {
  readonly itemId: string;
  readonly overageItemId: string;
  readonly periodStart: Date;
  readonly periodEnd: Date;
}

/** Lo que una suscripción de Stripe dice del add-on: si sigue ahí y en qué periodo de cobro está. */
export interface VoiceAddonSubscriptionFacts {
  readonly isPresent: boolean;
  readonly periodStart: Date | null;
  readonly periodEnd: Date | null;
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
  /**
   * El precio fijo mensual del add-on del Contestador IA para este plan. Si se da, la página de pago lo ofrece
   * como línea opcional: quien paga elige con o sin él y ve el total. Solo con pago mensual.
   */
  readonly voiceAddonPriceId: string | null;
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
      /** El add-on del Contestador IA en esa suscripción; `null` o ausente si el aviso no traía las líneas. */
      readonly voiceAddon?: VoiceAddonSubscriptionFacts | null;
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
  /**
   * Crea o reutiliza lo que Stripe necesita del add-on del Contestador IA: su producto, el medidor de minutos y,
   * por cada escalón de plan, la cuota fija y el precio del minuto de exceso. Repetirlo no duplica nada.
   */
  syncVoiceAddon(specs: readonly VoiceAddonPriceSpec[]): Promise<SyncedVoiceAddonPlan[]>;
  /**
   * Añade el add-on como líneas de la suscripción que el centro ya tiene (no abre otra suscripción). Si las
   * líneas ya están, las reutiliza: repetirlo no duplica nada.
   */
  attachVoiceAddon(input: {
    subscriptionId: string;
    monthlyPriceId: string;
    overagePriceId: string;
    taxRateId: string;
  }): Promise<VoiceAddonAttachment>;
  /** Si la suscripción ya tiene la línea fija del add-on (la eligió quien pagó en la página de pago). */
  hasVoiceAddonLine(subscriptionId: string): Promise<boolean>;
  /** Cambia las líneas del add-on al escalón de otro plan (el centro ha subido o bajado de plan). */
  changeVoiceAddonTier(input: {
    itemId: string;
    overageItemId: string;
    monthlyPriceId: string;
    overagePriceId: string;
  }): Promise<void>;
  /** Quita las líneas del add-on de la suscripción. Si ya no existen, no es un fallo. */
  detachVoiceAddon(input: { itemId: string; overageItemId: string | null }): Promise<void>;
  /**
   * Comunica a Stripe minutos de exceso para el medidor. `identifier` es único por llamada: si se repite, Stripe lo
   * descarta (ventana de al menos 24 horas), así que reintentar nunca cobra dos veces.
   */
  reportVoiceOverage(input: {
    customerId: string;
    minutes: number;
    identifier: string;
    occurredAt: Date;
  }): Promise<void>;
  verifyWebhook(input: {
    rawBody: Buffer;
    signatureHeader: string | undefined;
    now: Date;
  }): BillingWebhookResult;
}
