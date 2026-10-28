import { MILLISECONDS_PER_DAY } from '../../../shared/time/time-units';
import { GRACE_PERIOD_DAYS } from './subscription-rules';

export type PlanPaymentEmailKind =
  'trial_started' | 'trial_ending_7' | 'trial_ending_3' | 'trial_ending_1' | 'trial_ended';

/** Por qué se escribe al propietario: cambia el arranque del correo, no los enlaces de pago. */
export type PlanPaymentEmailReason =
  | { readonly type: 'trial_started' }
  | { readonly type: 'trial_ending'; readonly daysLeft: number }
  | { readonly type: 'trial_ended' };

interface EndingThreshold {
  readonly daysLeft: number;
  readonly kind: PlanPaymentEmailKind;
}

/** De menor a mayor: el aviso que toca es el del tramo más cercano al fin de la prueba. */
const ENDING_THRESHOLDS: readonly EndingThreshold[] = [
  { daysLeft: 1, kind: 'trial_ending_1' },
  { daysLeft: 3, kind: 'trial_ending_3' },
  { daysLeft: 7, kind: 'trial_ending_7' },
];

/** Hasta cuántos días antes del fin de la prueba se avisa. */
export const MAX_REMINDER_LEAD_DAYS = 7;
/** Tras acabar la prueba, el aviso de «ha terminado» solo tiene sentido mientras dure la gracia. */
export const ENDED_REMINDER_WINDOW_DAYS = GRACE_PERIOD_DAYS;

interface TrialDates {
  readonly trialEndsAt: Date;
  readonly now: Date;
}

export function countTrialDaysLeft(dates: TrialDates): number {
  return Math.ceil((dates.trialEndsAt.getTime() - dates.now.getTime()) / MILLISECONDS_PER_DAY);
}

function isEndedBeyondWindow(dates: TrialDates): boolean {
  const endedForMs = dates.now.getTime() - dates.trialEndsAt.getTime();
  return endedForMs > ENDED_REMINDER_WINDOW_DAYS * MILLISECONDS_PER_DAY;
}

function findCurrentKind(dates: TrialDates): PlanPaymentEmailKind | null {
  if (dates.trialEndsAt.getTime() <= dates.now.getTime()) {
    return isEndedBeyondWindow(dates) ? null : 'trial_ended';
  }
  const daysLeft = countTrialDaysLeft(dates);
  const threshold = ENDING_THRESHOLDS.find((candidate) => candidate.daysLeft >= daysLeft);
  // Con más de una semana por delante la prueba acaba de empezar: toca el correo de bienvenida.
  return threshold?.kind ?? 'trial_started';
}

/**
 * El aviso que toca ahora, o `null`. Cada tramo (bienvenida, 7, 3, 1 días y «acabada») se manda una vez: si el barrido
 * llega tarde y ya se está en el tramo de 1 día, no se manda el de 7. Los centros cuya prueba acabó hace más
 * de la gracia no reciben nada, para que encender el envío no escriba a centros antiguos.
 */
export function selectDueReminderKind(
  dates: TrialDates & { readonly sentKinds: readonly PlanPaymentEmailKind[] },
): PlanPaymentEmailKind | null {
  const currentKind = findCurrentKind(dates);
  if (currentKind === null || dates.sentKinds.includes(currentKind)) return null;
  return currentKind;
}

export function describeReminderReason(kind: PlanPaymentEmailKind): PlanPaymentEmailReason {
  if (kind === 'trial_started') return { type: 'trial_started' };
  const threshold = ENDING_THRESHOLDS.find((candidate) => candidate.kind === kind);
  if (threshold === undefined) return { type: 'trial_ended' };
  return { type: 'trial_ending', daysLeft: threshold.daysLeft };
}
