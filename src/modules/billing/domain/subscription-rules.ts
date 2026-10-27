import { MILLISECONDS_PER_DAY } from '../../../shared/time/time-units';

/** Días de margen tras un pago fallido o una prueba sin plan, antes de suspender (docs/spec/17 §2.2). */
export const GRACE_PERIOD_DAYS = 7;

export type CenterStatus = 'trial' | 'active' | 'past_due' | 'suspended';

export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'unpaid'
  | 'canceled'
  | 'incomplete'
  | 'incomplete_expired'
  | 'paused';

/** Lo que el cobro del plan decide de un centro: su estado y hasta cuándo dura la gracia. */
export interface CenterBillingState {
  readonly status: CenterStatus;
  readonly graceEndsAt: Date | null;
}

export function addGracePeriod(from: Date): Date {
  return new Date(from.getTime() + GRACE_PERIOD_DAYS * MILLISECONDS_PER_DAY);
}

function isSame(first: CenterBillingState, second: CenterBillingState): boolean {
  return (
    first.status === second.status && first.graceEndsAt?.getTime() === second.graceEndsAt?.getTime()
  );
}

/** Devuelve el estado nuevo solo si cambia; `null` si el aviso no cambia nada. */
function changeOnlyIfDifferent(
  current: CenterBillingState,
  next: CenterBillingState,
): CenterBillingState | null {
  return isSame(current, next) ? null : next;
}

/** Pagar reactiva al centro, esté en gracia o suspendido. */
export function applyPaymentSucceeded(current: CenterBillingState): CenterBillingState | null {
  return changeOnlyIfDifferent(current, { status: 'active', graceEndsAt: null });
}

/** El primer fallo abre la gracia; los siguientes reintentos de Stripe no la alargan. */
export function applyPaymentFailed(
  current: CenterBillingState,
  now: Date,
): CenterBillingState | null {
  if (current.status === 'suspended') return null;
  return changeOnlyIfDifferent(current, {
    status: 'past_due',
    graceEndsAt: current.graceEndsAt ?? addGracePeriod(now),
  });
}

/** Lo que Stripe dice de la suscripción manda sobre el estado del centro. */
export function applySubscriptionStatus(
  current: CenterBillingState,
  subscriptionStatus: SubscriptionStatus,
  now: Date,
): CenterBillingState | null {
  switch (subscriptionStatus) {
    case 'active':
      return applyPaymentSucceeded(current);
    case 'past_due':
    case 'unpaid':
      return applyPaymentFailed(current, now);
    case 'canceled':
    case 'incomplete_expired':
      return changeOnlyIfDifferent(current, { status: 'suspended', graceEndsAt: null });
    default:
      // `trialing` (el centro ya está en prueba), `incomplete` y `paused` no cambian nada.
      return null;
  }
}

export interface TrialFacts {
  readonly status: CenterStatus;
  readonly trialEndsAt: Date | null;
  readonly hasSubscription: boolean;
}

/** Una prueba acabada sin plan elegido abre la gracia. Con suscripción, es Stripe quien cobra. */
export function isTrialExpiredWithoutPlan(center: TrialFacts, now: Date): boolean {
  return (
    center.status === 'trial' &&
    !center.hasSubscription &&
    center.trialEndsAt !== null &&
    center.trialEndsAt.getTime() <= now.getTime()
  );
}

export function isGraceExpired(
  center: { readonly status: CenterStatus; readonly graceEndsAt: Date | null },
  now: Date,
): boolean {
  return (
    center.status === 'past_due' &&
    center.graceEndsAt !== null &&
    center.graceEndsAt.getTime() <= now.getTime()
  );
}

/** Una factura de 0 € (el inicio de una prueba con tarjeta) no es un cobro ni activa nada. */
export function isInvoiceChargeable(totalCents: number): boolean {
  return totalCents > 0;
}
