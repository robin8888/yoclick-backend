import {
  MILLISECONDS_PER_HOUR,
  MILLISECONDS_PER_MINUTE,
  MILLISECONDS_PER_SECOND,
} from '../../../shared/time/time-units';
import { toLocalDate } from '../../../shared/time/zoned-time';

/** Un turno no dura más: una entrada abierta de más de esto se da por olvidada. */
export const MAX_SHIFT_HOURS = 16;
const MAX_SHIFT_MS = MAX_SHIFT_HOURS * MILLISECONDS_PER_HOUR;

/** Repetir el escaneo dentro de esta ventana devuelve lo mismo (la cámara lee el QR varias veces). */
export const DUPLICATE_SCAN_WINDOW_SECONDS = 30;
const DUPLICATE_SCAN_WINDOW_MS = DUPLICATE_SCAN_WINDOW_SECONDS * MILLISECONDS_PER_SECOND;

export interface OpenShift {
  readonly id: string;
  readonly clockInAt: Date;
}

export interface LastShift {
  readonly id: string;
  readonly clockInAt: Date;
  readonly clockOutAt: Date | null;
}

export type ClockDecision =
  | { readonly kind: 'clock_in' }
  | { readonly kind: 'clock_out'; readonly entryId: string }
  /** La misma entrada o salida ya registrada hace segundos: no se duplica. */
  | { readonly kind: 'repeat'; readonly entryId: string; readonly action: 'clock_in' | 'clock_out' }
  /** Había una entrada abierta de más de 16 h: se descarta y se ficha una nueva. */
  | { readonly kind: 'clock_in_after_abandoned'; readonly abandonedEntryId: string };

/**
 * Qué hace un escaneo: alterna entrada y salida. `lastShift` es el turno más reciente de la persona
 * (abierto o cerrado); si es el abierto, `openShift` es ese mismo.
 */
export function decideClockAction(input: {
  readonly lastShift: LastShift | null;
  readonly now: Date;
}): ClockDecision {
  const { lastShift, now } = input;
  if (lastShift === null) return { kind: 'clock_in' };
  if (lastShift.clockOutAt === null) return decideForOpenShift(lastShift, now);
  const sinceLastClockOut = now.getTime() - lastShift.clockOutAt.getTime();
  if (sinceLastClockOut < DUPLICATE_SCAN_WINDOW_MS) {
    return { kind: 'repeat', entryId: lastShift.id, action: 'clock_out' };
  }
  return { kind: 'clock_in' };
}

function decideForOpenShift(openShift: OpenShift, now: Date): ClockDecision {
  const openForMs = now.getTime() - openShift.clockInAt.getTime();
  if (openForMs >= MAX_SHIFT_MS) {
    return { kind: 'clock_in_after_abandoned', abandonedEntryId: openShift.id };
  }
  if (openForMs < DUPLICATE_SCAN_WINDOW_MS) {
    return { kind: 'repeat', entryId: openShift.id, action: 'clock_in' };
  }
  return { kind: 'clock_out', entryId: openShift.id };
}

export type TimeEntryViolation = 'out_not_after_in' | 'too_long' | 'in_future';

/** Reglas de un intervalo escrito a mano o editado; `clockOutAt` nulo es un turno aún abierto. */
export function findTimeEntryViolation(input: {
  readonly clockInAt: Date;
  readonly clockOutAt: Date | null;
  readonly now: Date;
}): TimeEntryViolation | null {
  const { clockInAt, clockOutAt, now } = input;
  if (clockInAt.getTime() > now.getTime()) return 'in_future';
  if (clockOutAt === null) return null;
  if (clockOutAt.getTime() > now.getTime()) return 'in_future';
  if (clockOutAt.getTime() <= clockInAt.getTime()) return 'out_not_after_in';
  if (clockOutAt.getTime() - clockInAt.getTime() > MAX_SHIFT_MS) return 'too_long';
  return null;
}

export interface TimeRange {
  readonly clockInAt: Date;
  /** Nulo = sigue abierto, es decir, sin fin conocido. */
  readonly clockOutAt: Date | null;
}

/** Dos turnos se solapan si uno empieza antes de que el otro acabe; tocarse en un extremo no cuenta. */
export function doTimeRangesOverlap(first: TimeRange, second: TimeRange): boolean {
  const firstEnd = first.clockOutAt?.getTime() ?? Number.POSITIVE_INFINITY;
  const secondEnd = second.clockOutAt?.getTime() ?? Number.POSITIVE_INFINITY;
  return first.clockInAt.getTime() < secondEnd && second.clockInAt.getTime() < firstEnd;
}

/** Minutos completos trabajados; un turno abierto cuenta 0 hasta que se cierre. */
export function computeWorkedMinutes(range: TimeRange): number {
  if (range.clockOutAt === null) return 0;
  return Math.floor(
    (range.clockOutAt.getTime() - range.clockInAt.getTime()) / MILLISECONDS_PER_MINUTE,
  );
}

/** Fecha local del centro en la que cae la entrada (un turno de noche cuenta en el día en que empieza). */
export function deriveWorkDate(clockInAt: Date, timeZone: string): string {
  return toLocalDate(clockInAt, timeZone);
}

const DAY_DIGITS = 2;

export interface MonthDateRange {
  readonly fromDate: string;
  readonly toDate: string;
}

export function getMonthDateRange(month: string): MonthDateRange {
  const [year = 0, monthNumber = 1] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return {
    fromDate: `${month}-01`,
    toDate: `${month}-${String(lastDay).padStart(DAY_DIGITS, '0')}`,
  };
}

export interface MonthEntryFacts extends TimeRange {
  readonly workDate: string;
  readonly isEdited: boolean;
}

export interface MonthTotals {
  readonly workedMinutes: number;
  readonly daysWorked: number;
  readonly editedCount: number;
}

export function summarizeMonth(entries: readonly MonthEntryFacts[]): MonthTotals {
  const workedDates = new Set(entries.map((entry) => entry.workDate));
  return {
    workedMinutes: entries.reduce((sum, entry) => sum + computeWorkedMinutes(entry), 0),
    daysWorked: workedDates.size,
    editedCount: entries.filter((entry) => entry.isEdited).length,
  };
}
