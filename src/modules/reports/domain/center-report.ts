import {
  MILLISECONDS_PER_DAY,
  MILLISECONDS_PER_MINUTE,
  MINUTES_PER_HOUR,
} from '../../../shared/time/time-units';
import { addDaysToLocalDate, listLocalDates, toLocalDate } from '../../../shared/time/zoned-time';
import { resolveClientActivity } from '../../clients/domain/client-activity';
import { type OpeningHours } from '../../centers/domain/opening-hours';
import { calculateOccupancyPercent, sumOpenMinutes } from './day-summary';

export const REPORT_PERIODS = ['week', 'month', 'quarter'] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number];

const PERIOD_DAYS: Readonly<Record<ReportPeriod, number>> = { week: 7, month: 30, quarter: 90 };
export const INCOME_MONTH_COUNT = 6;
export const COHORT_MONTH_COUNT = 4;
/** Los datos que hacen falta remontan unos seis meses: ingresos por mes y cohortes de retención. */
export const REPORT_HISTORY_DAYS = 190;
const RETENTION_SHORT_DAYS = 30;
const RETENTION_LONG_DAYS = 90;
const PERCENT = 100;
const MONTH_KEY_LENGTH = 7;
const YEAR_DIGITS = 4;
const MONTH_DIGITS = 2;
const MONTHS_PER_YEAR = 12;
const HOURS_DECIMALS = 10;

export interface ReportBooking {
  readonly status: 'confirmed' | 'attended' | 'no_show';
  readonly clientMembershipId: string;
}

/** Una clase con al menos una cita que no se canceló. */
export interface ReportSession {
  readonly serviceId: string;
  readonly staffMembershipId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly bookings: readonly ReportBooking[];
}

export interface ReportService {
  readonly id: string;
  readonly name: string;
  readonly priceCents: number | null;
  /** Cuánta gente del equipo lo da: el tiempo disponible del servicio es el suyo. */
  readonly staffCount: number;
}

export interface ReportStaffMember {
  readonly membershipId: string;
  readonly fullName: string;
}

export interface ReportClient {
  readonly membershipId: string;
  readonly joinedAt: Date;
}

export interface ReportFacts {
  readonly now: Date;
  readonly timeZone: string;
  readonly openingHours: OpeningHours | null;
  readonly holidayDates: readonly string[];
  readonly bookableStaffCount: number;
  readonly services: readonly ReportService[];
  readonly staff: readonly ReportStaffMember[];
  readonly clients: readonly ReportClient[];
  readonly sessions: readonly ReportSession[];
}

export interface LocalRange {
  readonly fromDate: string;
  readonly toDate: string;
}

export interface CenterReport {
  readonly period: ReportPeriod;
  readonly range: LocalRange;
  readonly estimatedIncomeCents: number;
  readonly previousEstimatedIncomeCents: number;
  readonly averageOccupancyPercent: number | null;
  readonly retentionThreeMonthsPercent: number | null;
  readonly activeClientCount: number;
  readonly inactiveClientCount: number;
  readonly incomeByMonth: readonly { month: string; incomeCents: number }[];
  readonly services: readonly ServiceReportRow[];
  readonly staff: readonly StaffReportRow[];
  readonly retentionByJoinMonth: readonly CohortRow[];
}

export interface ServiceReportRow {
  readonly serviceId: string;
  readonly name: string;
  readonly sessionCount: number;
  readonly occupancyPercent: number | null;
}

export interface StaffReportRow {
  readonly membershipId: string;
  readonly fullName: string;
  readonly sessionCount: number;
  readonly hours: number;
  readonly occupancyPercent: number | null;
}

export interface CohortRow {
  readonly month: string;
  readonly joinedCount: number;
  readonly retainedAfterOneMonthPercent: number | null;
  readonly retainedAfterThreeMonthsPercent: number | null;
}

/** Los últimos 7, 30 o 90 días contando hoy, y los mismos días justo antes para comparar. */
export function resolvePeriodRanges(
  period: ReportPeriod,
  now: Date,
  timeZone: string,
): { current: LocalRange; previous: LocalRange } {
  const dayCount = PERIOD_DAYS[period];
  const toDate = toLocalDate(now, timeZone);
  const fromDate = addDaysToLocalDate(toDate, -(dayCount - 1));
  return {
    current: { fromDate, toDate },
    previous: {
      fromDate: addDaysToLocalDate(fromDate, -dayCount),
      toDate: addDaysToLocalDate(fromDate, -1),
    },
  };
}

function isInRange(session: ReportSession, range: LocalRange, timeZone: string): boolean {
  const localDate = toLocalDate(session.startsAt, timeZone);
  return localDate >= range.fromDate && localDate <= range.toDate;
}

function calculateSessionMinutes(session: ReportSession): number {
  return (session.endsAt.getTime() - session.startsAt.getTime()) / MILLISECONDS_PER_MINUTE;
}

/** Una cita cuenta como ingreso si la persona vino, o si estaba confirmada y la clase ya terminó. */
function countPaidBookings(session: ReportSession, now: Date): number {
  const hasEnded = session.endsAt.getTime() <= now.getTime();
  return session.bookings.filter(
    ({ status }) => status === 'attended' || (status === 'confirmed' && hasEnded),
  ).length;
}

export function estimateIncomeCents(
  sessions: readonly ReportSession[],
  priceByServiceId: ReadonlyMap<string, number | null>,
  now: Date,
): number {
  return sessions.reduce(
    (total, session) =>
      total + countPaidBookings(session, now) * (priceByServiceId.get(session.serviceId) ?? 0),
    0,
  );
}

/** Meses (`2026-09`) de más antiguo a más reciente, terminando en el de la fecha dada. */
export function listMonthsEndingAt(localDate: string, monthCount: number): string[] {
  const year = Number(localDate.slice(0, YEAR_DIGITS));
  const month = Number(localDate.slice(YEAR_DIGITS + 1, MONTH_KEY_LENGTH));
  return Array.from({ length: monthCount }, (_unused, offset) => {
    const monthIndex = year * MONTHS_PER_YEAR + (month - 1) - (monthCount - 1 - offset);
    const monthYear = Math.floor(monthIndex / MONTHS_PER_YEAR);
    const monthNumber = (monthIndex % MONTHS_PER_YEAR) + 1;
    return `${String(monthYear)}-${String(monthNumber).padStart(MONTH_DIGITS, '0')}`;
  });
}

function roundPercent(part: number, whole: number): number | null {
  return whole === 0 ? null : Math.round((part / whole) * PERCENT);
}

function sumBookedMinutes(sessions: readonly ReportSession[]): number {
  return sessions.reduce((total, session) => total + calculateSessionMinutes(session), 0);
}

function buildServiceRows(
  facts: ReportFacts,
  sessions: readonly ReportSession[],
  openMinutes: number,
): ServiceReportRow[] {
  return facts.services
    .map((service) => {
      const ofService = sessions.filter(({ serviceId }) => serviceId === service.id);
      return {
        serviceId: service.id,
        name: service.name,
        sessionCount: ofService.length,
        occupancyPercent: calculateOccupancyPercent({
          bookedMinutes: sumBookedMinutes(ofService),
          openMinutes,
          staffCount: service.staffCount,
        }),
      };
    })
    .filter(({ sessionCount }) => sessionCount > 0)
    .sort((first, second) => (second.occupancyPercent ?? -1) - (first.occupancyPercent ?? -1));
}

function buildStaffRows(
  facts: ReportFacts,
  sessions: readonly ReportSession[],
  openMinutes: number,
): StaffReportRow[] {
  return facts.staff
    .map((member) => {
      const ofMember = sessions.filter(
        ({ staffMembershipId }) => staffMembershipId === member.membershipId,
      );
      const bookedMinutes = sumBookedMinutes(ofMember);
      return {
        membershipId: member.membershipId,
        fullName: member.fullName,
        sessionCount: ofMember.length,
        hours: Math.round((bookedMinutes / MINUTES_PER_HOUR) * HOURS_DECIMALS) / HOURS_DECIMALS,
        occupancyPercent: calculateOccupancyPercent({ bookedMinutes, openMinutes, staffCount: 1 }),
      };
    })
    .filter(({ sessionCount }) => sessionCount > 0)
    .sort((first, second) => second.sessionCount - first.sessionCount);
}

function findLastBookingByClient(sessions: readonly ReportSession[]): Map<string, Date> {
  const lastBookingByClient = new Map<string, Date>();
  for (const session of sessions) {
    for (const { clientMembershipId } of session.bookings) {
      const previous = lastBookingByClient.get(clientMembershipId);
      if (!previous || previous < session.startsAt) {
        lastBookingByClient.set(clientMembershipId, session.startsAt);
      }
    }
  }
  return lastBookingByClient;
}

function countClientsByActivity(facts: ReportFacts): { active: number; inactive: number } {
  const lastBookingByClient = findLastBookingByClient(facts.sessions);
  const counts = { active: 0, inactive: 0 };
  for (const client of facts.clients) {
    const activity = resolveClientActivity({
      joinedAt: client.joinedAt,
      lastBookingAt: lastBookingByClient.get(client.membershipId) ?? null,
      now: facts.now,
    });
    if (activity === 'active') counts.active += 1;
    if (activity === 'inactive') counts.inactive += 1;
  }
  return counts;
}

/**
 * Quienes siguen viniendo pasado un tiempo: de las personas que llevan al menos `afterDays` en el
 * centro, cuántas tienen una cita (no cancelada) desde entonces. `null` si aún ninguna lleva tanto.
 */
export function calculateRetentionPercent(
  clients: readonly ReportClient[],
  sessions: readonly ReportSession[],
  options: { readonly afterDays: number; readonly now: Date },
): number | null {
  const bookingsByClient = new Map<string, Date[]>();
  for (const session of sessions) {
    for (const { clientMembershipId } of session.bookings) {
      bookingsByClient.set(clientMembershipId, [
        ...(bookingsByClient.get(clientMembershipId) ?? []),
        session.startsAt,
      ]);
    }
  }
  const eligibleClients = clients.filter(
    ({ joinedAt }) =>
      joinedAt.getTime() + options.afterDays * MILLISECONDS_PER_DAY <= options.now.getTime(),
  );
  const retainedCount = eligibleClients.filter(({ membershipId, joinedAt }) =>
    (bookingsByClient.get(membershipId) ?? []).some(
      (startsAt) =>
        startsAt.getTime() >= joinedAt.getTime() + options.afterDays * MILLISECONDS_PER_DAY,
    ),
  ).length;
  return roundPercent(retainedCount, eligibleClients.length);
}

function buildCohortRows(facts: ReportFacts): CohortRow[] {
  const months = listMonthsEndingAt(toLocalDate(facts.now, facts.timeZone), COHORT_MONTH_COUNT);
  return months.map((month) => {
    const cohort = facts.clients.filter(
      ({ joinedAt }) => toLocalDate(joinedAt, facts.timeZone).slice(0, MONTH_KEY_LENGTH) === month,
    );
    return {
      month,
      joinedCount: cohort.length,
      retainedAfterOneMonthPercent: calculateRetentionPercent(cohort, facts.sessions, {
        afterDays: RETENTION_SHORT_DAYS,
        now: facts.now,
      }),
      retainedAfterThreeMonthsPercent: calculateRetentionPercent(cohort, facts.sessions, {
        afterDays: RETENTION_LONG_DAYS,
        now: facts.now,
      }),
    };
  });
}

function buildIncomeByMonth(
  facts: ReportFacts,
  priceByServiceId: ReadonlyMap<string, number | null>,
): { month: string; incomeCents: number }[] {
  const months = listMonthsEndingAt(toLocalDate(facts.now, facts.timeZone), INCOME_MONTH_COUNT);
  return months.map((month) => ({
    month,
    incomeCents: estimateIncomeCents(
      facts.sessions.filter(
        ({ startsAt }) =>
          toLocalDate(startsAt, facts.timeZone).slice(0, MONTH_KEY_LENGTH) === month,
      ),
      priceByServiceId,
      facts.now,
    ),
  }));
}

function countOpenMinutes(facts: ReportFacts, range: LocalRange): number {
  return listLocalDates(range.fromDate, range.toDate).reduce(
    (total, date) => total + sumOpenMinutes(facts.openingHours, facts.holidayDates, date),
    0,
  );
}

export function buildCenterReport(facts: ReportFacts, period: ReportPeriod): CenterReport {
  const { current, previous } = resolvePeriodRanges(period, facts.now, facts.timeZone);
  const inCurrent = facts.sessions.filter((session) => isInRange(session, current, facts.timeZone));
  const inPrevious = facts.sessions.filter((session) =>
    isInRange(session, previous, facts.timeZone),
  );
  const priceByServiceId = new Map(facts.services.map(({ id, priceCents }) => [id, priceCents]));
  const openMinutes = countOpenMinutes(facts, current);
  const clientsByActivity = countClientsByActivity(facts);

  return {
    period,
    range: current,
    estimatedIncomeCents: estimateIncomeCents(inCurrent, priceByServiceId, facts.now),
    previousEstimatedIncomeCents: estimateIncomeCents(inPrevious, priceByServiceId, facts.now),
    averageOccupancyPercent: calculateOccupancyPercent({
      bookedMinutes: sumBookedMinutes(inCurrent),
      openMinutes,
      staffCount: facts.bookableStaffCount,
    }),
    retentionThreeMonthsPercent: calculateRetentionPercent(facts.clients, facts.sessions, {
      afterDays: RETENTION_LONG_DAYS,
      now: facts.now,
    }),
    activeClientCount: clientsByActivity.active,
    inactiveClientCount: clientsByActivity.inactive,
    incomeByMonth: buildIncomeByMonth(facts, priceByServiceId),
    services: buildServiceRows(facts, inCurrent, openMinutes),
    staff: buildStaffRows(facts, inCurrent, openMinutes),
    retentionByJoinMonth: buildCohortRows(facts),
  };
}
