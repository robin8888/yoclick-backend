/** Suma meses sin desbordar: desde el 31 de enero, un mes después es el 28 o 29 de febrero, no marzo. */
export function addMonthsToInstant(anchor: Date, months: number): Date {
  const target = new Date(anchor);
  target.setUTCDate(1);
  target.setUTCMonth(target.getUTCMonth() + months);
  const lastDayOfTargetMonth = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(anchor.getUTCDate(), lastDayOfTargetMonth));
  return target;
}
