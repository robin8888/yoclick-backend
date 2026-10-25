import { type AuditEntryInput } from '../application/ports/platform.repository';

export const MAX_PLAN_PRICE_CENTS = 1_000_000;

export interface PlanPrices {
  readonly monthlyPriceCents: number;
  readonly annualMonthlyPriceCents: number;
  readonly setupFeeCents: number;
}

export interface PlanPriceChanges {
  readonly monthlyPriceCents?: number | undefined;
  readonly annualMonthlyPriceCents?: number | undefined;
  readonly setupFeeCents?: number | undefined;
}

const PRICE_FIELDS = ['monthlyPriceCents', 'annualMonthlyPriceCents', 'setupFeeCents'] as const;

/** Los importes que quedarían tras aplicar los cambios, para validarlos juntos. */
export function applyPlanPriceChanges(current: PlanPrices, changes: PlanPriceChanges): PlanPrices {
  return {
    monthlyPriceCents: changes.monthlyPriceCents ?? current.monthlyPriceCents,
    annualMonthlyPriceCents: changes.annualMonthlyPriceCents ?? current.annualMonthlyPriceCents,
    setupFeeCents: changes.setupFeeCents ?? current.setupFeeCents,
  };
}

/** Pagar el año entero nunca puede salir más caro por mes que pagar mes a mes. */
export function arePlanPricesValid(prices: PlanPrices): boolean {
  const isWithinRange = PRICE_FIELDS.every(
    (field) =>
      Number.isInteger(prices[field]) &&
      prices[field] >= 0 &&
      prices[field] <= MAX_PLAN_PRICE_CENTS,
  );
  return isWithinRange && prices.annualMonthlyPriceCents <= prices.monthlyPriceCents;
}

/** Un rastro de auditoría por cada importe que cambia de verdad; uno igual al actual no deja nada. */
export function describePlanPriceChanges(
  planId: string,
  current: PlanPrices,
  changes: PlanPriceChanges,
): AuditEntryInput[] {
  return PRICE_FIELDS.flatMap((field) => {
    const to = changes[field];
    if (to === undefined || to === current[field]) return [];
    return [{ action: 'plan_price_changed', details: { planId, field, from: current[field], to } }];
  });
}

export interface PlanRevenueRow {
  readonly monthlyPriceCents: number;
  /** Centros que pagan: activos y en gracia (la prueba y los suspendidos no cuentan). */
  readonly payingCenterCount: number;
}

/** Ingresos recurrentes al mes, sin IVA: precio mensual de cada plan por sus centros que pagan. */
export function computeMonthlyRecurringRevenueCents(rows: readonly PlanRevenueRow[]): number {
  return rows.reduce((total, row) => total + row.monthlyPriceCents * row.payingCenterCount, 0);
}
