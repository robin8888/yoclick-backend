import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '../../../shared/errors/domain-error';
import { HTTP_STATUS } from '../../../shared/errors/http-status';
import { PushDispatcher } from '../../push/application/push-dispatcher';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { isOverClientLimit } from '../domain/client-limit';
import {
  addGracePeriod,
  applyPaymentFailed,
  applyPaymentSucceeded,
  applySubscriptionStatus,
  isGraceExpired,
  isInvoiceChargeable,
  isTrialExpiredWithoutPlan,
  type CenterBillingState,
} from '../domain/subscription-rules';
import { openCheckoutSession, type CheckoutChoice } from './open-checkout-session';
import {
  activateVoiceAddonChosenAtCheckout,
  syncVoiceAddonWithSubscription,
} from './voice-addon-sync';
import {
  BILLING_GATEWAY,
  type BillingEvent,
  type BillingGateway,
  type SyncedPlan,
} from './ports/billing-gateway';
import {
  BILLING_REPOSITORY,
  type BillingCenter,
  type BillingRepository,
  type BillingTransaction,
  type PlanOffer,
} from './ports/billing.repository';

const BASIS_POINTS_PER_UNIT = 10_000;
const DAY_LENGTH = 10;

function toBillingState(center: BillingCenter): CenterBillingState {
  return { status: center.status, graceEndsAt: center.graceEndsAt };
}

/** Aplica el cambio de estado que decidió una regla, si lo hay, y lo deja en la auditoría. */
async function moveCenterTo(
  transaction: BillingTransaction,
  center: BillingCenter,
  next: CenterBillingState | null,
  reason: string,
): Promise<void> {
  if (next === null) return;
  await transaction.updateCenter(center.id, { status: next.status, graceEndsAt: next.graceEndsAt });
  await transaction.writeAudit({
    centerId: center.id,
    action: 'center_status_changed',
    details: { from: center.status, to: next.status, reason },
  });
}

export type CheckoutInput = CheckoutChoice;

/** Los planes que el propietario puede contratar, con su precio mensual y anual. */
@Injectable()
export class ListPlanOffersUseCase {
  constructor(@Inject(BILLING_REPOSITORY) private readonly billing: BillingRepository) {}

  execute(actor: ActorContext): Promise<PlanOffer[]> {
    return this.billing.listPlanOffers(actor);
  }
}

/** El propietario elige plan y periodicidad: se le da la página de pago de Stripe (nunca dentro de la app). */
@Injectable()
export class CreateCheckoutSessionUseCase {
  constructor(
    @Inject(BILLING_REPOSITORY) private readonly billing: BillingRepository,
    @Inject(BILLING_GATEWAY) private readonly gateway: BillingGateway,
  ) {}

  async execute(actor: ActorContext, input: CheckoutInput): Promise<{ url: string }> {
    return openCheckoutSession({
      gateway: this.gateway,
      facts: await this.billing.findCheckoutFacts(actor, input.planId),
      choice: input,
      saveCustomerId: (customerId) => this.billing.saveCustomerId(actor, customerId),
    });
  }
}

/** El portal de Stripe: cambiar de plan o de periodicidad, la tarjeta, ver facturas y cancelar. */
@Injectable()
export class CreatePortalSessionUseCase {
  constructor(
    @Inject(BILLING_REPOSITORY) private readonly billing: BillingRepository,
    @Inject(BILLING_GATEWAY) private readonly gateway: BillingGateway,
  ) {}

  async execute(actor: ActorContext): Promise<{ url: string }> {
    const customerId = await this.billing.findCustomerId(actor);
    // Quien nunca ha pagado no tiene nada que gestionar: primero elige plan.
    if (customerId === null) throw new DomainError('CONFLICT', HTTP_STATUS.conflict);
    return this.gateway.createPortalSession({ customerId });
  }
}

interface BillingEventContext {
  readonly transaction: BillingTransaction;
  readonly gateway: BillingGateway;
  readonly now: Date;
}

/** Atiende un aviso de Stripe ya verificado. Cada aviso se procesa una sola vez. */
async function handleBillingEvent(
  context: BillingEventContext,
  event: BillingEvent,
): Promise<ActorContext[]> {
  const { transaction, now } = context;
  if (!(await transaction.markEventAsNew(event.eventId, event.type))) return [];
  if (event.type === 'checkout_completed') {
    return handleCheckoutCompleted(context, event);
  }
  const center = await transaction.findCenterByCustomerId(event.customerId);
  if (center === null) return [];
  if (event.type === 'subscription_changed') {
    return handleSubscriptionChanged(context, center, event);
  }
  if (event.type === 'invoice_paid') {
    await handleInvoicePaid(transaction, center, event);
  } else {
    await moveCenterTo(
      transaction,
      center,
      applyPaymentFailed(toBillingState(center), now),
      'payment_failed',
    );
  }
  return [];
}

/**
 * Si el plan nuevo deja al centro con más clientes que su tope, se avisa una vez al propietario. No se toca
 * a nadie: solo se frenan las altas nuevas hasta que vuelva por debajo, o suba de plan.
 */
async function notifyIfOverClientLimit(
  transaction: BillingTransaction,
  center: BillingCenter,
  planId: string,
): Promise<ActorContext[]> {
  const load = await transaction.readClientLoad(center.id);
  if (!isOverClientLimit(load)) return [];
  return transaction.notifyOwners({
    centerId: center.id,
    kind: 'plan_over_limit',
    data: {
      planId,
      activeClientCount: String(load.activeClientCount),
      maxClients: String(load.maxClients),
    },
  });
}

async function handleSubscriptionChanged(
  context: BillingEventContext,
  center: BillingCenter,
  event: Extract<BillingEvent, { type: 'subscription_changed' }>,
): Promise<ActorContext[]> {
  const { transaction, now } = context;
  let notifiedOwners: ActorContext[] = [];
  // El cliente puede cambiar de plan o de periodicidad desde el portal: se copia al centro lo que dice Stripe.
  if (event.planId !== null && event.planId !== center.planId) {
    await transaction.updateCenter(center.id, { planId: event.planId });
    await transaction.writeAudit({
      centerId: center.id,
      action: 'plan_changed',
      details: { from: center.planId, to: event.planId },
    });
    // Si aún no había suscripción, es la contratación inicial y la avisa `checkout_completed`.
    if (center.stripeSubscriptionId !== null) {
      notifiedOwners = await transaction.notifyOwners({
        centerId: center.id,
        kind: 'plan_changed',
        data: { planId: event.planId },
      });
    }
    notifiedOwners = [
      ...notifiedOwners,
      ...(await notifyIfOverClientLimit(transaction, center, event.planId)),
    ];
  }
  if (event.period !== null) {
    await transaction.updateCenter(center.id, { billingPeriod: event.period });
  }
  const next = applySubscriptionStatus(toBillingState(center), event.status, now);
  await moveCenterTo(transaction, center, next, `subscription_${event.status}`);
  await syncVoiceAddonWithSubscription({
    transaction,
    gateway: context.gateway,
    centerBeforeEvent: center,
    event,
  });
  return notifiedOwners;
}

async function handleCheckoutCompleted(
  context: BillingEventContext,
  event: Extract<BillingEvent, { type: 'checkout_completed' }>,
): Promise<ActorContext[]> {
  const { transaction } = context;
  const center = await transaction.findCenterById(event.centerId);
  if (center === null) return [];
  await transaction.updateCenter(center.id, {
    planId: event.planId,
    stripeCustomerId: event.customerId,
    stripeSubscriptionId: event.subscriptionId,
    billingPeriod: event.period,
  });
  await transaction.writeAudit({
    centerId: center.id,
    action: 'plan_subscribed',
    details: { planId: event.planId, period: event.period },
  });
  const subscribedOwners = await transaction.notifyOwners({
    centerId: center.id,
    kind: 'plan_subscribed',
    data: { planId: event.planId },
  });
  await activateVoiceAddonChosenAtCheckout(context, event);
  const overLimitOwners = await notifyIfOverClientLimit(transaction, center, event.planId);
  return [...subscribedOwners, ...overLimitOwners];
}

async function handleInvoicePaid(
  transaction: BillingTransaction,
  center: BillingCenter,
  event: Extract<BillingEvent, { type: 'invoice_paid' }>,
): Promise<void> {
  if (!isInvoiceChargeable(event.totalCents)) return;
  await transaction.recordStripeCharge({
    centerId: center.id,
    stripeInvoiceId: event.invoiceId,
    chargedOn: new Date(event.paidAt.toISOString().slice(0, DAY_LENGTH)),
    concept: event.description === '' ? `Suscripción plan ${center.planId}` : event.description,
    baseCents: event.baseCents,
    vatBasisPoints:
      event.baseCents === 0
        ? 0
        : Math.round((event.vatCents * BASIS_POINTS_PER_UNIT) / event.baseCents),
    vatCents: event.vatCents,
    totalCents: event.totalCents,
    invoiceReference: null,
  });
  await moveCenterTo(
    transaction,
    center,
    applyPaymentSucceeded(toBillingState(center)),
    'invoice_paid',
  );
}

@Injectable()
export class HandleBillingWebhookUseCase {
  constructor(
    @Inject(BILLING_REPOSITORY) private readonly billing: BillingRepository,
    @Inject(BILLING_GATEWAY) private readonly gateway: BillingGateway,
    private readonly pushDispatcher: PushDispatcher,
  ) {}

  /** Un aviso con firma falsa o que no es del cobro del plan se ignora sin más: de eso se encarga el otro receptor. */
  async execute(input: { rawBody: Buffer; signatureHeader: string | undefined }): Promise<void> {
    const now = new Date();
    const result = this.gateway.verifyWebhook({ ...input, now });
    if (!result.isSignatureValid || result.event === null) return;
    const { event } = result;
    const notifiedOwners = await this.billing.runInTransaction((transaction) =>
      handleBillingEvent({ transaction, gateway: this.gateway, now }, event),
    );
    // Tras confirmar: el push es el aviso al móvil y nunca debe deshacer el cambio de plan.
    const [firstOwner] = notifiedOwners;
    if (firstOwner !== undefined) await this.pushDispatcher.flushCenter(firstOwner);
  }
}

export interface SweepSummary {
  readonly gracesOpened: number;
  readonly centersSuspended: number;
}

/** Abre la gracia de las pruebas acabadas sin plan y suspende a los centros que agotaron la suya. */
@Injectable()
export class SweepSubscriptionsUseCase {
  constructor(@Inject(BILLING_REPOSITORY) private readonly billing: BillingRepository) {}

  execute(now: Date): Promise<SweepSummary> {
    return this.billing.runInTransaction(async (transaction) => {
      const candidates = await transaction.listCentersToSweep(now);
      let gracesOpened = 0;
      let centersSuspended = 0;
      for (const center of candidates) {
        const facts = { ...center, hasSubscription: center.stripeSubscriptionId !== null };
        if (isTrialExpiredWithoutPlan(facts, now)) {
          await moveCenterTo(
            transaction,
            center,
            { status: 'past_due', graceEndsAt: addGracePeriod(now) },
            'trial_expired',
          );
          gracesOpened += 1;
        } else if (isGraceExpired(center, now)) {
          await moveCenterTo(
            transaction,
            center,
            { status: 'suspended', graceEndsAt: null },
            'grace_expired',
          );
          centersSuspended += 1;
        }
      }
      return { gracesOpened, centersSuspended };
    });
  }
}

/** Crea en Stripe los productos y precios de los planes y guarda sus ids (`npm run billing:setup`). */
@Injectable()
export class SyncStripePlansUseCase {
  constructor(
    @Inject(BILLING_REPOSITORY) private readonly billing: BillingRepository,
    @Inject(BILLING_GATEWAY) private readonly gateway: BillingGateway,
  ) {}

  async execute(): Promise<SyncedPlan[]> {
    const specs = await this.billing.listPlanSpecs();
    const synced = await this.gateway.syncPlans(specs);
    await this.billing.savePlanStripeIds(synced);
    await this.gateway.configurePortal(synced);
    // El add-on del Contestador IA comparte producto de IVA y cliente con los planes, pero tiene su producto,
    // su medidor de minutos y sus precios por escalón. Sus importes salen de `voice_addon_plans`.
    const voiceAddonSpecs = await this.billing.listVoiceAddonSpecs();
    await this.billing.saveVoiceAddonStripeIds(await this.gateway.syncVoiceAddon(voiceAddonSpecs));
    return synced;
  }
}
