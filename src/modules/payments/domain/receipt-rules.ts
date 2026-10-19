/** IVA general. Los precios de los bonos lo llevan incluido: el centro no lo configura. */
export const VAT_RATE_PERCENT = 21;

const PERCENT_DIVISOR = 100;
const RECEIPT_SEQUENCE_DIGITS = 6;

/** De un total con IVA incluido: la base imponible y la cuota de IVA, que suman exactamente el total. */
export function splitVatIncluded(totalCents: number): { baseCents: number; vatCents: number } {
  const baseCents = Math.round(
    (totalCents * PERCENT_DIVISOR) / (PERCENT_DIVISOR + VAT_RATE_PERCENT),
  );
  return { baseCents, vatCents: totalCents - baseCents };
}

/** `2026-000007`: el año del cobro y el orden dentro de ese año en el centro. */
export function buildReceiptNumber(input: { year: number; sequence: number }): string {
  return `${String(input.year)}-${String(input.sequence).padStart(RECEIPT_SEQUENCE_DIGITS, '0')}`;
}

/** Los datos que un recibo necesita del centro: sin ellos no puede cobrar online. */
export function isFiscalDataComplete(center: {
  legalName: string | null;
  taxId: string | null;
  taxAddress: string | null;
}): boolean {
  return [center.legalName, center.taxId, center.taxAddress].every(
    (field) => field !== null && field.trim() !== '',
  );
}
