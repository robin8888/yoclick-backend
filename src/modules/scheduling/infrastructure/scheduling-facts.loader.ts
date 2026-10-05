import { type TenantTransactionClient } from '../../../shared/database/tenant-prisma.service';
import {
  getUtcRangeOfLocalDates,
  toLocalDate,
  type UtcRange,
} from '../../../shared/time/zoned-time';
import { type OpeningHours } from '../../centers/domain/opening-hours';
import { type BusyInterval, type StaffCandidate } from '../domain/available-slots';
import {
  type SchedulingDateRange,
  type SchedulingFacts,
  type SchedulingFactsQuery,
} from '../application/ports/scheduling-facts.repository';

const TEAM_ROLES = ['owner', 'admin', 'staff'] as const;

interface StoredHoliday {
  readonly date: string;
}

function resolveLocalDates(
  dateRange: SchedulingDateRange,
  timeZone: string,
): { fromDate: string; toDate: string } {
  if ('aroundInstant' in dateRange) {
    const date = toLocalDate(dateRange.aroundInstant, timeZone);
    return { fromDate: date, toDate: date };
  }
  return dateRange;
}

async function findServiceWithStaff(client: TenantTransactionClient, query: SchedulingFactsQuery) {
  return client.service.findFirst({
    where: {
      id: query.serviceId,
      archivedAt: null,
      ...(!query.canSeeHiddenService && { isVisible: true }),
    },
    include: {
      staff: {
        where: { membership: { status: 'active', role: { in: [...TEAM_ROLES] } } },
        include: { membership: { select: { id: true, user: { select: { fullName: true } } } } },
      },
    },
  });
}

async function findBusyIntervals(
  client: TenantTransactionClient,
  staff: readonly StaffCandidate[],
  range: UtcRange,
): Promise<BusyInterval[]> {
  return client.classSession.findMany({
    where: {
      status: 'scheduled',
      staffMembershipId: { in: staff.map((member) => member.membershipId) },
      startsAt: { lt: range.endsAt },
      endsAt: { gt: range.startsAt },
    },
    select: { staffMembershipId: true, startsAt: true, endsAt: true },
  });
}

/**
 * Lee, dentro de la transacción de tenant que ya tiene el llamante, todo lo necesario para calcular
 * huecos: el servicio, el horario y los festivos del centro, quién lo atiende y qué tienen ya
 * ocupado. Lo usa tanto la consulta de huecos como la reserva (que además bloquea y escribe en la
 * misma transacción), para que ambas decidan con exactamente los mismos datos.
 */
export async function loadSchedulingFacts(
  client: TenantTransactionClient,
  query: SchedulingFactsQuery,
): Promise<SchedulingFacts | null> {
  const service = await findServiceWithStaff(client, query);
  if (!service) return null;

  const center = await client.center.findFirstOrThrow({
    select: { timezone: true, openingHours: true, holidays: true },
  });
  const staff = service.staff.map(({ membership }) => ({
    membershipId: membership.id,
    fullName: membership.user.fullName,
  }));
  const { fromDate, toDate } = resolveLocalDates(query.dateRange, center.timezone);
  const range = getUtcRangeOfLocalDates(fromDate, toDate, center.timezone);

  return {
    service: {
      id: service.id,
      name: service.name,
      color: service.color,
      durationMinutes: service.durationMinutes,
      minNoticeMinutes: service.minNoticeMinutes,
      bookingWindowDays: service.bookingWindowDays,
    },
    timeZone: center.timezone,
    // Escrito por esta API tras validarlo con zod (ajustes del centro).
    openingHours: center.openingHours as OpeningHours | null,
    holidayDates: ((center.holidays ?? []) as unknown as StoredHoliday[]).map(({ date }) => date),
    staff,
    busyIntervals: await findBusyIntervals(client, staff, range),
  };
}
