import { type OpeningHours, type OpeningInterval } from '../../centers/domain/opening-hours';
import { MILLISECONDS_PER_DAY } from '../../../shared/time/time-units';
import {
  addMinutes,
  getWeekdayOfLocalDate,
  listLocalDates,
  toLocalDate,
  zonedDateTimeToUtc,
} from '../../../shared/time/zoned-time';

import { isStaffAvailableForSlot, type StaffAvailabilityRules } from './staff-availability';

export interface StaffCandidate extends StaffAvailabilityRules {
  readonly membershipId: string;
  readonly fullName: string;
}

/** Un tramo en el que una persona del equipo ya tiene una sesión programada. */
export interface BusyInterval {
  readonly staffMembershipId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

export interface SlotCalculationInput {
  readonly timeZone: string;
  readonly openingHours: OpeningHours | null;
  /** Fechas locales de cierre (`YYYY-MM-DD`). */
  readonly holidayDates: readonly string[];
  readonly fromDate: string;
  readonly toDate: string;
  readonly durationMinutes: number;
  /**
   * Cada cuántos minutos puede empezar un hueco. Sin él, cada `durationMinutes` desde la apertura
   * (lo que ve la clientela); el equipo lo baja (p. ej. a 15) para elegir horas como las 10:30.
   */
  readonly stepMinutes?: number | undefined;
  readonly minNoticeMinutes: number;
  readonly bookingWindowDays: number;
  readonly now: Date;
  readonly staff: readonly StaffCandidate[];
  readonly busyIntervals: readonly BusyInterval[];
}

export interface CalculatedSlot {
  readonly startsAt: Date;
  readonly endsAt: Date;
  /** Quienes están libres a esa hora, la primera opción delante (la persona con menos citas ese día). */
  readonly freeStaff: readonly StaffCandidate[];
}

export interface CalculatedDay {
  readonly date: string;
  readonly slots: readonly CalculatedSlot[];
}

export interface BookingWindowRules {
  readonly now: Date;
  readonly minNoticeMinutes: number;
  readonly bookingWindowDays: number;
}

/** Se puede reservar desde `ahora + antelación mínima` hasta `ahora + ventana de días`, ambos incluidos. */
export function isStartWithinBookingWindow(startsAt: Date, rules: BookingWindowRules): boolean {
  const earliestStart = addMinutes(rules.now, rules.minNoticeMinutes);
  const latestStart = new Date(
    rules.now.getTime() + rules.bookingWindowDays * MILLISECONDS_PER_DAY,
  );
  return startsAt >= earliestStart && startsAt <= latestStart;
}

function overlaps(first: { startsAt: Date; endsAt: Date }, second: BusyInterval): boolean {
  return first.startsAt < second.endsAt && second.startsAt < first.endsAt;
}

/**
 * Rejilla del día: un hueco cada `stepMinutes` (por defecto, la duración) desde la apertura de cada tramo, y el hueco ha
 * de caber entero en el tramo. Se cuenta en tiempo real desde la apertura, así que un día con cambio
 * de hora no desplaza ni inventa huecos.
 */
function buildGridOfInterval(
  input: {
    date: string;
    timeZone: string;
    durationMinutes: number;
    stepMinutes?: number | undefined;
  },
  interval: OpeningInterval,
): { startsAt: Date; endsAt: Date }[] {
  const intervalStart = zonedDateTimeToUtc(input.date, interval.opensAt, input.timeZone);
  const intervalEnd = zonedDateTimeToUtc(input.date, interval.closesAt, input.timeZone);
  const grid: { startsAt: Date; endsAt: Date }[] = [];
  const stepMinutes = input.stepMinutes ?? input.durationMinutes;
  let startsAt = intervalStart;
  while (addMinutes(startsAt, input.durationMinutes) <= intervalEnd) {
    grid.push({ startsAt, endsAt: addMinutes(startsAt, input.durationMinutes) });
    startsAt = addMinutes(startsAt, stepMinutes);
  }
  return grid;
}

/** Cuántas citas tiene cada persona del equipo en un día local: criterio para repartir el trabajo. */
function countBusyIntervalsPerStaff(
  input: SlotCalculationInput,
  date: string,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const busy of input.busyIntervals) {
    if (toLocalDate(busy.startsAt, input.timeZone) !== date) continue;
    counts.set(busy.staffMembershipId, (counts.get(busy.staffMembershipId) ?? 0) + 1);
  }
  return counts;
}

function orderByLeastBusy(
  freeStaff: readonly StaffCandidate[],
  busyCounts: ReadonlyMap<string, number>,
): StaffCandidate[] {
  return [...freeStaff].sort(
    (first, second) =>
      (busyCounts.get(first.membershipId) ?? 0) - (busyCounts.get(second.membershipId) ?? 0) ||
      first.membershipId.localeCompare(second.membershipId),
  );
}

function calculateSlotsOfDate(input: SlotCalculationInput, date: string): CalculatedSlot[] {
  if (input.holidayDates.includes(date)) return [];
  const intervals = input.openingHours?.[getWeekdayOfLocalDate(date)] ?? [];
  const busyCounts = countBusyIntervalsPerStaff(input, date);

  return intervals
    .flatMap((interval) => buildGridOfInterval({ ...input, date }, interval))
    .filter((candidate) => isStartWithinBookingWindow(candidate.startsAt, input))
    .flatMap((candidate) => {
      const freeStaff = input.staff.filter(
        (member) =>
          isStaffAvailableForSlot(member, candidate, input.timeZone) &&
          !input.busyIntervals.some(
            (busy) => busy.staffMembershipId === member.membershipId && overlaps(candidate, busy),
          ),
      );
      return freeStaff.length === 0
        ? []
        : [{ ...candidate, freeStaff: orderByLeastBusy(freeStaff, busyCounts) }];
    });
}

/**
 * Huecos reservables de un servicio: horario semanal del centro, menos festivos, menos el horario propio y las
 * ausencias de cada profesional y lo ya reservado por él o ella, dentro de la antelación mínima y la ventana de reserva.
 * Todo el cálculo de fechas se hace en la zona horaria del centro; los resultados salen en UTC.
 */
export function calculateAvailableSlots(input: SlotCalculationInput): CalculatedDay[] {
  return listLocalDates(input.fromDate, input.toDate).map((date) => ({
    date,
    slots: calculateSlotsOfDate(input, date),
  }));
}
