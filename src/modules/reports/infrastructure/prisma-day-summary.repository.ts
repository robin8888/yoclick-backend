import { Injectable } from '@nestjs/common';
import {
  type TenantTransactionClient,
  TenantPrismaService,
} from '../../../shared/database/tenant-prisma.service';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { getUtcRangeOfLocalDates, type UtcRange } from '../../../shared/time/zoned-time';
import { type OpeningHours } from '../../centers/domain/opening-hours';
import {
  type DaySummaryFacts,
  type DaySummaryRepository,
} from '../application/ports/day-summary.repository';
import { getWeekOfLocalDate } from '../domain/day-summary';

const TEAM_ROLES = ['owner', 'admin', 'staff'] as const;
const MILLISECONDS_PER_MINUTE = 60_000;

interface StoredHoliday {
  readonly date: string;
}

async function countBookableStaff(client: TenantTransactionClient): Promise<number> {
  return client.membership.count({
    where: {
      status: 'active',
      role: { in: [...TEAM_ROLES] },
      serviceAssignments: { some: { service: { archivedAt: null } } },
    },
  });
}

async function sumBookedMinutes(client: TenantTransactionClient, range: UtcRange): Promise<number> {
  const sessions = await client.classSession.findMany({
    where: {
      startsAt: { gte: range.startsAt, lt: range.endsAt },
      bookings: { some: { status: { not: 'cancelled' } } },
    },
    select: { startsAt: true, endsAt: true },
  });
  return sessions.reduce(
    (total, session) =>
      total + (session.endsAt.getTime() - session.startsAt.getTime()) / MILLISECONDS_PER_MINUTE,
    0,
  );
}

async function countNewClients(client: TenantTransactionClient, range: UtcRange): Promise<number> {
  return client.membership.count({
    where: { role: 'client', joinedAt: { gte: range.startsAt, lt: range.endsAt } },
  });
}

@Injectable()
export class PrismaDaySummaryRepository implements DaySummaryRepository {
  constructor(private readonly tenantPrismaService: TenantPrismaService) {}

  async findFacts(actor: ActorContext, query: { date: string }): Promise<DaySummaryFacts> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const center = await client.center.findFirstOrThrow({
        select: { timezone: true, openingHours: true, holidays: true },
      });
      const week = getWeekOfLocalDate(query.date);
      const dayRange = getUtcRangeOfLocalDates(query.date, query.date, center.timezone);
      const weekRange = getUtcRangeOfLocalDates(week.fromDate, week.toDate, center.timezone);

      return {
        timeZone: center.timezone,
        // Escrito por esta API tras validarlo con zod (ajustes del centro).
        openingHours: center.openingHours as OpeningHours | null,
        holidayDates: ((center.holidays ?? []) as unknown as StoredHoliday[]).map(
          ({ date }) => date,
        ),
        bookableStaffCount: await countBookableStaff(client),
        bookedMinutes: await sumBookedMinutes(client, dayRange),
        newClientCount: await countNewClients(client, weekRange),
        activeClientCount: await client.membership.count({
          where: { role: 'client', status: 'active' },
        }),
      };
    });
  }
}
