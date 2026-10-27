import { type ActorContext } from '../../../../shared/tenancy/actor-context';
import { type PlanFeatureId } from '../../../../shared/centers/plan-features';
import { type CenterStatus } from '../../domain/subscription-rules';
import { type BillingPeriod, type PlanPriceSpec, type SyncedPlan } from './billing-gateway';

export const BILLING_REPOSITORY = Symbol('BILLING_REPOSITORY');

/** Un centro visto desde el cobro de su plan. */
export interface BillingCenter {
  readonly id: string;
  readonly name: string;
  readonly status: CenterStatus;
  readonly planId: string;
  readonly trialEndsAt: Date | null;
  readonly graceEndsAt: Date | null;
  readonly stripeCustomerId: string | null;
  readonly stripeSubscriptionId: string | null;
}

export interface BillingCenterChanges {
  readonly status?: CenterStatus;
  readonly graceEndsAt?: Date | null;
  /** Al cambiar de plan se copian al centro los límites del nuevo plan. */
  readonly planId?: string;
  readonly stripeCustomerId?: string;
  readonly stripeSubscriptionId?: string;
  readonly billingPeriod?: BillingPeriod;
}

export interface StripeChargeInput {
  readonly centerId: string;
  readonly stripeInvoiceId: string;
  readonly chargedOn: Date;
  readonly concept: string;
  readonly baseCents: number;
  readonly vatBasisPoints: number;
  readonly vatCents: number;
  readonly totalCents: number;
  readonly invoiceReference: string | null;
}

export interface PlanNotificationInput {
  readonly centerId: string;
  readonly kind: 'plan_subscribed' | 'plan_changed';
  readonly data: Readonly<Record<string, string>>;
}

/** Todo lo que un aviso de Stripe o el barrido de gracias hace, dentro de una sola transacción. */
export interface BillingTransaction {
  /** `false` si este aviso ya se procesó (Stripe reintenta). */
  markEventAsNew(eventId: string, eventType: string): Promise<boolean>;
  findCenterById(centerId: string): Promise<BillingCenter | null>;
  findCenterByCustomerId(customerId: string): Promise<BillingCenter | null>;
  updateCenter(centerId: string, changes: BillingCenterChanges): Promise<void>;
  recordStripeCharge(charge: StripeChargeInput): Promise<void>;
  writeAudit(input: {
    centerId: string;
    action: string;
    details: Readonly<Record<string, unknown>>;
  }): Promise<void>;
  /** Deja un aviso a cada propietario del centro y devuelve quiénes son, para enviarles el push. */
  notifyOwners(input: PlanNotificationInput): Promise<ActorContext[]>;
  /** Pruebas acabadas sin plan y gracias agotadas: los candidatos a cambiar de estado. */
  listCentersToSweep(now: Date): Promise<BillingCenter[]>;
}

/** Los ids de Stripe del plan que el propietario va a contratar. */
export interface PlanStripePrices {
  readonly monthlyPriceId: string;
  readonly annualPriceId: string;
  readonly setupFeePriceId: string | null;
  readonly taxRateId: string;
}

export interface CheckoutFacts {
  readonly center: BillingCenter;
  readonly ownerEmail: string | null;
  /** `null` si `billing:setup` aún no ha creado los precios de ese plan en Stripe. */
  readonly planPrices: PlanStripePrices | null;
}

/** Un plan tal y como se ofrece al propietario: precios sin IVA y lo que incluye. */
export interface PlanOffer {
  readonly id: string;
  readonly name: string;
  readonly monthlyPriceCents: number;
  /** Precio por mes pagando el año entero; el cargo anual es este importe por doce. */
  readonly annualMonthlyPriceCents: number;
  readonly setupFeeCents: number;
  readonly maxClients: number | null;
  readonly documentStorageLimitBytes: number;
  readonly videoStorageLimitBytes: number | null;
  /** Funciones que da el plan además de los topes; cada plan suma las del anterior. */
  readonly features: readonly PlanFeatureId[];
  /** Se puede contratar: sus precios ya existen en Stripe. */
  readonly isAvailable: boolean;
}

export interface BillingRepository {
  listPlanOffers(actor: ActorContext): Promise<PlanOffer[]>;
  runInTransaction<TResult>(
    work: (transaction: BillingTransaction) => Promise<TResult>,
  ): Promise<TResult>;
  listPlanSpecs(): Promise<PlanPriceSpec[]>;
  savePlanStripeIds(plans: readonly SyncedPlan[]): Promise<void>;
  findCheckoutFacts(actor: ActorContext, planId: string): Promise<CheckoutFacts | null>;
  saveCustomerId(actor: ActorContext, customerId: string): Promise<void>;
  /** El cliente de Stripe del centro; `null` si todavía no ha contratado nada. */
  findCustomerId(actor: ActorContext): Promise<string | null>;
}
