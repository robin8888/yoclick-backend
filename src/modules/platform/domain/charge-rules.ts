import { type AuditEntryInput } from '../application/ports/platform.repository';

export const CHARGE_STATUSES = ['pending', 'paid', 'void'] as const;
export const PAYMENT_METHODS = ['transfer', 'card', 'cash', 'other'] as const;

export type ChargeStatus = (typeof CHARGE_STATUSES)[number];
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

const BASIS_POINTS_PER_UNIT = 10_000;
const CENTS_PER_EURO = 100;
const MONTH_KEY_LENGTH = 7;
const DAY_KEY_LENGTH = 10;
const MONTHS_PER_YEAR = 12;
const YEAR_DIGITS = 4;
const MONTH_DIGITS = 2;
const DECIMAL_DIGITS = 2;

export interface ChargeAmounts {
  readonly baseCents: number;
  readonly vatCents: number;
  readonly totalCents: number;
}

/** La cuota se redondea al céntimo más cercano; el total es siempre base más cuota. */
export function computeChargeAmounts(input: {
  readonly baseCents: number;
  readonly vatBasisPoints: number;
}): ChargeAmounts {
  const vatCents = Math.round((input.baseCents * input.vatBasisPoints) / BASIS_POINTS_PER_UNIT);
  return {
    baseCents: input.baseCents,
    vatCents,
    totalCents: input.baseCents + vatCents,
  };
}

/** Mes natural (`YYYY-MM`) al que pertenece un día `YYYY-MM-DD`. */
export function getMonthKey(day: string): string {
  return day.slice(0, MONTH_KEY_LENGTH);
}

/** Primer día del mes siguiente: el límite superior (excluido) de un rango de meses. */
export function getFirstDayAfterMonth(monthKey: string): string {
  const [year = 0, month = 1] = monthKey.split('-').map(Number);
  const isLastMonthOfYear = month === MONTHS_PER_YEAR;
  const nextYear = isLastMonthOfYear ? year + 1 : year;
  const nextMonth = isLastMonthOfYear ? 1 : month + 1;
  return `${String(nextYear).padStart(YEAR_DIGITS, '0')}-${String(nextMonth).padStart(MONTH_DIGITS, '0')}-01`;
}

export interface ReportableCharge extends ChargeAmounts {
  readonly chargedOn: string;
  readonly status: ChargeStatus;
  readonly stripeFeeCents: number | null;
}

export interface MonthlyChargeSummary extends ChargeAmounts {
  readonly month: string;
  readonly chargeCount: number;
  readonly stripeFeeCents: number;
}

/** Solo cuentan los cobros `paid`: los pendientes y los anulados no son ingreso todavía (o ya no). */
export function summarizeChargesByMonth(
  charges: readonly ReportableCharge[],
): MonthlyChargeSummary[] {
  const summaries = new Map<string, MonthlyChargeSummary>();
  for (const charge of charges) {
    if (charge.status !== 'paid') continue;
    const month = getMonthKey(charge.chargedOn);
    const current = summaries.get(month) ?? {
      month,
      baseCents: 0,
      vatCents: 0,
      totalCents: 0,
      chargeCount: 0,
      stripeFeeCents: 0,
    };
    summaries.set(month, {
      month,
      baseCents: current.baseCents + charge.baseCents,
      vatCents: current.vatCents + charge.vatCents,
      totalCents: current.totalCents + charge.totalCents,
      chargeCount: current.chargeCount + 1,
      stripeFeeCents: current.stripeFeeCents + (charge.stripeFeeCents ?? 0),
    });
  }
  return [...summaries.values()].sort((first, second) => first.month.localeCompare(second.month));
}

export function sumMonthlySummaries(
  months: readonly MonthlyChargeSummary[],
): Omit<MonthlyChargeSummary, 'month'> {
  return months.reduce(
    (totals, month) => ({
      baseCents: totals.baseCents + month.baseCents,
      vatCents: totals.vatCents + month.vatCents,
      totalCents: totals.totalCents + month.totalCents,
      chargeCount: totals.chargeCount + month.chargeCount,
      stripeFeeCents: totals.stripeFeeCents + month.stripeFeeCents,
    }),
    { baseCents: 0, vatCents: 0, totalCents: 0, chargeCount: 0, stripeFeeCents: 0 },
  );
}

export interface ChargeCsvRow extends ReportableCharge {
  readonly centerName: string;
  readonly customerLegalName: string | null;
  readonly customerTaxId: string | null;
  readonly vatBasisPoints: number;
  readonly paymentMethod: PaymentMethod;
  readonly invoiceReference: string | null;
  readonly stripeId: string | null;
}

const CSV_SEPARATOR = ';';
const CSV_HEADER = [
  'Fecha de cobro',
  'Periodo',
  'Centro',
  'Razón social',
  'NIF',
  'Base imponible',
  'Tipo de IVA',
  'Cuota de IVA',
  'Total',
  'Comisión de Stripe',
  'Método',
  'Referencia de factura',
  'Id de Stripe',
];
const FORMULA_PREFIXES = ['=', '+', '-', '@', '\t', '\r'];

/** Euros con coma decimal, como espera una hoja de cálculo en español. */
function formatCentsForSpreadsheet(cents: number): string {
  return (cents / CENTS_PER_EURO).toFixed(DECIMAL_DIGITS).replace('.', ',');
}

/** 2100 puntos básicos son «21»; 1050, «10,5». */
function formatVatRate(vatBasisPoints: number): string {
  return String(vatBasisPoints / CENTS_PER_EURO).replace('.', ',');
}

/**
 * Una celda de texto que empezara por `=`, `+`, `-` o `@` la ejecutaría una hoja de cálculo como fórmula:
 * el nombre de un centro lo escribe un tercero, así que se neutraliza con un apóstrofo.
 */
function escapeCsvText(value: string): string {
  const safeValue = FORMULA_PREFIXES.some((prefix) => value.startsWith(prefix))
    ? `'${value}`
    : value;
  const isQuotingNeeded = /[";\n\r]/.test(safeValue);
  return isQuotingNeeded ? `"${safeValue.replaceAll('"', '""')}"` : safeValue;
}

function toCsvLine(row: ChargeCsvRow): string {
  return [
    row.chargedOn,
    getMonthKey(row.chargedOn),
    escapeCsvText(row.centerName),
    escapeCsvText(row.customerLegalName ?? ''),
    escapeCsvText(row.customerTaxId ?? ''),
    formatCentsForSpreadsheet(row.baseCents),
    formatVatRate(row.vatBasisPoints),
    formatCentsForSpreadsheet(row.vatCents),
    formatCentsForSpreadsheet(row.totalCents),
    row.stripeFeeCents === null ? '' : formatCentsForSpreadsheet(row.stripeFeeCents),
    row.paymentMethod,
    escapeCsvText(row.invoiceReference ?? ''),
    escapeCsvText(row.stripeId ?? ''),
  ].join(CSV_SEPARATOR);
}

/** El CSV del gestor: solo cobros `paid`, ordenados por día. La app no presenta impuestos: entrega datos. */
export function buildChargesCsv(rows: readonly ChargeCsvRow[]): string {
  const paidRows = rows
    .filter((row) => row.status === 'paid')
    .sort((first, second) => first.chargedOn.localeCompare(second.chargedOn));
  return [CSV_HEADER.join(CSV_SEPARATOR), ...paidRows.map(toCsvLine)].join('\r\n') + '\r\n';
}

export interface ChargeChanges {
  readonly status?: ChargeStatus | undefined;
  readonly invoiceReference?: string | null | undefined;
}

export interface ChargeSnapshot {
  readonly status: ChargeStatus;
  readonly invoiceReference: string | null;
}

/** Un rastro por cada cambio real; un cobro anulado ya no admite cambios (sería reescribir el historial). */
export function describeChargeChanges(
  chargeId: string,
  current: ChargeSnapshot,
  changes: ChargeChanges,
): AuditEntryInput[] {
  const entries: AuditEntryInput[] = [];
  if (changes.status !== undefined && changes.status !== current.status) {
    entries.push({
      action: 'charge_status_changed',
      details: { chargeId, from: current.status, to: changes.status },
    });
  }
  if (
    changes.invoiceReference !== undefined &&
    changes.invoiceReference !== current.invoiceReference
  ) {
    entries.push({
      action: 'charge_invoice_set',
      details: { chargeId, from: current.invoiceReference, to: changes.invoiceReference },
    });
  }
  return entries;
}

export function canChargeBeChanged(current: ChargeSnapshot): boolean {
  return current.status !== 'void';
}

const MAX_REPORT_MONTHS = 36;

function toMonthIndex(monthKey: string): number {
  const [year = 0, month = 1] = monthKey.split('-').map(Number);
  return year * MONTHS_PER_YEAR + month - 1;
}

/** Un informe va de un mes a otro posterior o igual, y no abarca más de tres años. */
export function isReportRangeValid(range: { fromMonth: string; toMonth: string }): boolean {
  const monthCount = toMonthIndex(range.toMonth) - toMonthIndex(range.fromMonth) + 1;
  return monthCount >= 1 && monthCount <= MAX_REPORT_MONTHS;
}

/** Un cobro no puede llevar fecha futura: se apunta cuando ya se ha cobrado. */
export function isChargeDayAcceptable(chargedOn: string, now: Date): boolean {
  return chargedOn <= now.toISOString().slice(0, DAY_KEY_LENGTH);
}
