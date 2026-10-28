import { DomainError } from '../../../shared/errors/domain-error';
import { HTTP_STATUS } from '../../../shared/errors/http-status';
import { type BillingGateway, type BillingPeriod } from './ports/billing-gateway';
import { type CheckoutFacts } from './ports/billing.repository';

export interface CheckoutChoice {
  readonly planId: string;
  readonly period: BillingPeriod;
}

interface OpenCheckoutSessionInput {
  readonly gateway: BillingGateway;
  readonly facts: CheckoutFacts | null;
  readonly choice: CheckoutChoice;
  readonly saveCustomerId: (customerId: string) => Promise<void>;
}

async function ensureStripeCustomer(
  input: OpenCheckoutSessionInput,
  facts: CheckoutFacts,
): Promise<string> {
  if (facts.center.stripeCustomerId !== null) return facts.center.stripeCustomerId;
  const { customerId } = await input.gateway.createCustomer({
    centerId: facts.center.id,
    name: facts.center.name,
    email: facts.ownerEmail,
  });
  await input.saveCustomerId(customerId);
  return customerId;
}

/**
 * Abre una página de pago de Stripe para el plan elegido. La comparten el propietario con sesión y el
 * enlace firmado de un correo: las reglas (plan con precios, sin suscripción activa, primer cobro tras la
 * prueba) son las mismas; solo cambia cómo se leen los datos del centro.
 */
export async function openCheckoutSession(
  input: OpenCheckoutSessionInput,
): Promise<{ url: string }> {
  const { facts, choice } = input;
  if (facts === null) throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
  const { center, planPrices } = facts;
  // Un plan sin precios en Stripe es un fallo de preparación nuestro, no del propietario.
  if (planPrices === null) throw new DomainError('CONFLICT', HTTP_STATUS.conflict);
  if (center.stripeSubscriptionId !== null && center.status === 'active') {
    throw new DomainError('CONFLICT', HTTP_STATUS.conflict);
  }
  const customerId = await ensureStripeCustomer(input, facts);
  const isTrialRunning =
    center.status === 'trial' && center.trialEndsAt !== null && center.trialEndsAt > new Date();
  return input.gateway.createCheckoutSession({
    customerId,
    centerId: center.id,
    planId: choice.planId,
    period: choice.period,
    priceId: choice.period === 'annual' ? planPrices.annualPriceId : planPrices.monthlyPriceId,
    setupFeePriceId: planPrices.setupFeePriceId,
    taxRateId: planPrices.taxRateId,
    firstChargeAt: isTrialRunning ? center.trialEndsAt : null,
  });
}
