import {
  type ActorContext,
  type MembershipRoleName,
} from '../../../../shared/tenancy/actor-context';
import { type PlanFeatureId } from '../../../../shared/centers/plan-features';
import { type PlanPaymentEmailKind } from '../../domain/plan-payment-reminders';
import { type ClientLoad } from '../../domain/client-limit';
import { type CenterStatus } from '../../domain/subscription-rules';
import {
  type BillingPeriod,
  type PlanPriceSpec,
  type SyncedPlan,
  type SyncedVoiceAddonPlan,
  type VoiceAddonPriceSpec,
} from './billing-gateway';

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
  /** Se apaga solo cuando el add-on del Contestador IA se cancela. */
  readonly isVoiceReceptionistEnabled?: boolean;
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
  readonly kind:
    | 'plan_subscribed'
    | 'plan_changed'
    | 'plan_over_limit'
    | 'voice_minutes_80'
    | 'voice_minutes_100';
  readonly data: Readonly<Record<string, string>>;
  /** Además de los propietarios, avisa a la administración del centro (que también ve el Contestador IA). */
  readonly includeAdmins?: boolean;
}

/** Quién recibe los correos de pago de un centro: sus propietarios activos. */
export interface PlanOwnerContact {
  readonly email: string;
  readonly fullName: string;
}

export type VoiceSubscriptionStatusName = 'active' | 'paused' | 'cancelled';

/** El add-on del Contestador IA de un centro, visto desde el cobro: estado, minutos, periodo y líneas de Stripe. */
export interface BillingVoiceSubscription {
  readonly status: VoiceSubscriptionStatusName;
  readonly includedMinutes: number;
  readonly periodStart: Date;
  readonly periodEnd: Date;
  readonly stripeItemId: string | null;
  readonly stripeOverageItemId: string | null;
}

/** El add-on que se acaba de contratar en la página de pago. */
export interface NewBillingVoiceSubscription {
  readonly includedMinutes: number;
  readonly periodStart: Date;
  readonly periodEnd: Date;
  readonly stripeItemId: string;
  readonly stripeOverageItemId: string;
}

export interface BillingVoiceSubscriptionChanges {
  readonly status?: VoiceSubscriptionStatusName;
  readonly includedMinutes?: number;
  readonly periodStart?: Date;
  readonly periodEnd?: Date;
}

/** Lo que el add-on da y cuesta en un escalón de plan, y sus precios de Stripe (`null` sin `billing:setup`). */
export interface VoiceAddonTier {
  readonly planId: string;
  readonly includedMinutes: number;
  readonly monthlyPriceId: string | null;
  readonly overagePriceId: string | null;
}

/** Un centro en prueba, sus propietarios y qué correos de pago ya se le enviaron. */
export interface TrialReminderCandidate {
  readonly center: BillingCenter;
  readonly owners: readonly PlanOwnerContact[];
  readonly sentKinds: readonly PlanPaymentEmailKind[];
}

/** Lo que hace falta saber de un centro para cerrarlo. */
export interface CenterClosureFacts {
  readonly name: string;
  readonly stripeSubscriptionId: string | null;
  /** Ya cerrado: cerrarlo otra vez no hace nada. */
  readonly closedAt: Date | null;
}

export interface CenterMemberRef {
  readonly membershipId: string;
  readonly userId: string;
  readonly role: MembershipRoleName;
}

export interface OwnedCenterRef {
  readonly centerId: string;
  readonly name: string;
}

export interface CenterClosedNotificationInput {
  readonly centerId: string;
  readonly recipientMembershipIds: readonly string[];
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
  /** Cuántos clientes activos tiene el centro y el tope de su plan actual. */
  readClientLoad(centerId: string): Promise<ClientLoad>;
  /** Deja un aviso a cada propietario (y, si se pide, a la administración) y devuelve quiénes son, para el push. */
  notifyOwners(input: PlanNotificationInput): Promise<ActorContext[]>;
  /** Los propietarios activos del centro con su correo, para los avisos que también van por email. */
  listOwnerContacts(centerId: string): Promise<PlanOwnerContact[]>;
  findVoiceSubscription(centerId: string): Promise<BillingVoiceSubscription | null>;
  updateVoiceSubscription(
    centerId: string,
    changes: BillingVoiceSubscriptionChanges,
  ): Promise<void>;
  findVoiceAddonTier(planId: string): Promise<VoiceAddonTier | null>;
  /** Crea el add-on del centro, o lo reactiva si estuvo cancelado. Repetirlo no duplica nada. */
  saveChosenVoiceSubscription(
    centerId: string,
    subscription: NewBillingVoiceSubscription,
  ): Promise<void>;
  /** El IVA de Stripe del plan; `null` si `billing:setup` aún no lo ha creado. */
  findPlanTaxRateId(planId: string): Promise<string | null>;
  /** Si algún escalón del add-on tiene ya sus precios en Stripe, es decir, si la página de pago puede ofrecerlo. */
  isVoiceAddonOffered(): Promise<boolean>;
  /** Pruebas acabadas sin plan y gracias agotadas: los candidatos a cambiar de estado. */
  listCentersToSweep(now: Date): Promise<BillingCenter[]>;
  /** Los centros cuyo único propietario activo es esta persona y que siguen abiertos. */
  listCentersSolelyOwnedBy(userId: string): Promise<OwnedCenterRef[]>;
  findCenterForClosure(centerId: string): Promise<CenterClosureFacts | null>;
  /** Quienes están dentro del centro (membresías activas), con su rol. */
  listActiveMembers(centerId: string): Promise<CenterMemberRef[]>;
  markCenterClosed(centerId: string, closedAt: Date): Promise<void>;
  /** Un aviso `center_closed` por destinatario; el contexto de cobro escribe avisos pero no los lee. */
  notifyCenterClosed(input: CenterClosedNotificationInput): Promise<void>;
  /** Saca a todos del centro (membresía `left`): desaparece de sus listas y nadie puede actuar en él. */
  endAllMemberships(centerId: string): Promise<void>;
  /** Centros sin suscripción cuya prueba acaba en pocos días o acabó hace poco: los que pueden necesitar un aviso. */
  listTrialReminderCandidates(now: Date): Promise<TrialReminderCandidate[]>;
  /** Los planes que ya se pueden contratar, para listarlos en el correo de pago. */
  listAvailablePlanOffers(): Promise<PlanOffer[]>;
  /** Apunta el envío; `false` si ese correo ya estaba apuntado (otra vuelta del barrido lo envió). */
  claimPlanPaymentEmail(centerId: string, kind: PlanPaymentEmailKind): Promise<boolean>;
  /** Lo que hace falta para abrir la página de pago de un centro sin sesión (enlace firmado de un correo). */
  findCheckoutFactsForCenter(centerId: string, planId: string): Promise<CheckoutFacts | null>;
  saveCustomerIdForCenter(centerId: string, customerId: string): Promise<void>;
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
  /** El precio fijo del add-on del Contestador IA para el plan elegido; `null` si aún no existe en Stripe. */
  readonly voiceAddonPriceId: string | null;
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
  listVoiceAddonSpecs(): Promise<VoiceAddonPriceSpec[]>;
  saveVoiceAddonStripeIds(plans: readonly SyncedVoiceAddonPlan[]): Promise<void>;
  findCheckoutFacts(actor: ActorContext, planId: string): Promise<CheckoutFacts | null>;
  saveCustomerId(actor: ActorContext, customerId: string): Promise<void>;
  /** El cliente de Stripe del centro; `null` si todavía no ha contratado nada. */
  findCustomerId(actor: ActorContext): Promise<string | null>;
}
