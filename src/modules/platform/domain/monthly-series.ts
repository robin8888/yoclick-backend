const MONTHS_IN_YEAR = 12;
const MONTH_KEY_LENGTH = 7;
const MONTH_DIGITS = 2;

export interface MonthlyCount {
  /** `YYYY-MM` en UTC. */
  readonly month: string;
  readonly count: number;
}

function formatMonthKey(year: number, monthIndex: number): string {
  return `${String(year)}-${String(monthIndex + 1).padStart(MONTH_DIGITS, '0')}`;
}

/** Las últimas `monthCount` claves `YYYY-MM` hasta el mes de `now` incluido, de la más antigua a la más reciente. */
export function listRecentMonthKeys(now: Date, monthCount: number): string[] {
  return Array.from({ length: monthCount }, (_unused, offsetFromOldest) => {
    const monthsBack = monthCount - 1 - offsetFromOldest;
    const totalMonths = now.getUTCFullYear() * MONTHS_IN_YEAR + now.getUTCMonth() - monthsBack;
    return formatMonthKey(Math.floor(totalMonths / MONTHS_IN_YEAR), totalMonths % MONTHS_IN_YEAR);
  });
}

/** El primer instante (UTC) de la primera de las últimas `monthCount` meses: desde ahí se piden los datos. */
export function getSeriesStart(now: Date, monthCount: number): Date {
  const [firstKey = ''] = listRecentMonthKeys(now, monthCount);
  return new Date(`${firstKey.slice(0, MONTH_KEY_LENGTH)}-01T00:00:00.000Z`);
}

/** Rellena con 0 los meses sin datos, para que la gráfica no tenga huecos. */
export function fillMonthlySeries(
  monthKeys: readonly string[],
  counts: readonly MonthlyCount[],
): MonthlyCount[] {
  const countsByMonth = new Map(counts.map(({ month, count }) => [month, count]));
  return monthKeys.map((month) => ({ month, count: countsByMonth.get(month) ?? 0 }));
}
