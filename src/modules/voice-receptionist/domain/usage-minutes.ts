import { addMonthsToInstant } from '../../../shared/time/add-months';
const SECONDS_PER_BILLED_MINUTE = 60;
const FULL_PERCENT = 100;

/** Cada llamada se factura por minutos enteros empezados, como las operadoras: 61 s son 2 minutos. */
export function calculateBilledMinutes(durationSeconds: number): number {
  if (durationSeconds <= 0) return 0;
  return Math.ceil(durationSeconds / SECONDS_PER_BILLED_MINUTE);
}

export interface UsagePeriod {
  readonly periodStart: Date;
  readonly periodEnd: Date;
}

const MAX_PERIOD_STEPS = 240;

function buildCalendarMonth(now: Date): UsagePeriod {
  return {
    periodStart: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    periodEnd: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  };
}

/**
 * El periodo en el que se cuentan los minutos: el de la suscripción del add-on, que sigue el ciclo de cobro de
 * Stripe. Si Stripe aún no ha avisado de la renovación, se avanza (o retrocede) mes a mes desde el último
 * periodo conocido, con el mismo día de cobro. Sin suscripción, el mes natural en UTC.
 */
export function resolveUsagePeriod(now: Date, known: UsagePeriod | null): UsagePeriod {
  if (known === null) return buildCalendarMonth(now);
  let monthsFromKnown = 0;
  let current = known;
  for (let step = 0; step < MAX_PERIOD_STEPS; step += 1) {
    if (now >= current.periodEnd) monthsFromKnown += 1;
    else if (now < current.periodStart) monthsFromKnown -= 1;
    else return current;
    current = {
      periodStart: addMonthsToInstant(known.periodStart, monthsFromKnown),
      periodEnd: addMonthsToInstant(known.periodStart, monthsFromKnown + 1),
    };
  }
  return buildCalendarMonth(now);
}

/** Clave de `voice_usage_periods`. */
export function resolveUsagePeriodStart(now: Date, known: UsagePeriod | null): Date {
  return resolveUsagePeriod(now, known).periodStart;
}

/** Los avisos al propietario: al llegar al 80 % y al 100 % de los minutos incluidos. */
export const WARNING_PERCENT = 80;
export const EXHAUSTED_PERCENT = 100;
export const USAGE_ALERT_PERCENTS = [WARNING_PERCENT, EXHAUSTED_PERCENT] as const;
export type UsageAlertPercent = (typeof USAGE_ALERT_PERCENTS)[number];

/**
 * Los umbrales que esta llamada ha cruzado: el minuto que lo alcanza cuenta. Sin minutos incluidos, el primer
 * minuto cruza los dos.
 */
export function findCrossedUsageThresholds(input: {
  readonly includedMinutes: number;
  readonly usedBefore: number;
  readonly usedAfter: number;
}): UsageAlertPercent[] {
  const { includedMinutes, usedBefore, usedAfter } = input;
  return USAGE_ALERT_PERCENTS.filter((percent) => {
    const thresholdMinutes = Math.max(Math.ceil((includedMinutes * percent) / FULL_PERCENT), 1);
    return usedBefore < thresholdMinutes && thresholdMinutes <= usedAfter;
  });
}

/** Cuántos minutos de una llamada pasan de lo incluido: solo esos se facturan como exceso. */
export function calculateCallOverageMinutes(input: {
  readonly includedMinutes: number;
  readonly usedBefore: number;
  readonly billedMinutes: number;
}): number {
  const { includedMinutes, usedBefore, billedMinutes } = input;
  const usedAfter = usedBefore + billedMinutes;
  return Math.max(usedAfter - Math.max(includedMinutes, usedBefore), 0);
}

/**
 * El identificador con el que se comunica a Stripe el exceso de una llamada. Es único por llamada, así que Stripe
 * descarta cualquier repetición: reintentar nunca cobra dos veces.
 */
export function buildOverageMeterIdentifier(callLogId: string): string {
  return `yoclick-voice-overage-${callLogId}`;
}

export type VoiceOveragePolicyName = 'continue_and_charge' | 'disable_bot';

/**
 * Si el bot atiende: con «apagar al agotar» deja de contestar al llegar a los minutos incluidos y la llamada
 * sigue su camino normal hasta el siguiente periodo (o hasta que el propietario cambie la política).
 */
export function shouldBotAnswer(input: {
  readonly overagePolicy: VoiceOveragePolicyName;
  readonly includedMinutes: number;
  readonly usedMinutes: number;
}): boolean {
  if (input.overagePolicy !== 'disable_bot') return true;
  return input.usedMinutes < input.includedMinutes;
}

export interface VoiceUsageSummary {
  readonly includedMinutes: number;
  readonly usedMinutes: number;
  readonly remainingMinutes: number;
  readonly overageMinutes: number;
  /** 0 a 100 (se queda en 100 aunque haya exceso). */
  readonly usedPercent: number;
}

export function summarizeVoiceUsage(input: {
  readonly includedMinutes: number;
  readonly usedMinutes: number;
}): VoiceUsageSummary {
  const { includedMinutes, usedMinutes } = input;
  const usedPercent =
    includedMinutes === 0
      ? FULL_PERCENT
      : Math.min(FULL_PERCENT, Math.floor((usedMinutes / includedMinutes) * FULL_PERCENT));
  return {
    includedMinutes,
    usedMinutes,
    remainingMinutes: Math.max(includedMinutes - usedMinutes, 0),
    overageMinutes: Math.max(usedMinutes - includedMinutes, 0),
    usedPercent,
  };
}
