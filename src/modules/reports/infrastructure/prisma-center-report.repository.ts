import { Injectable } from '@nestjs/common';
import {
  TenantPrismaService,
  type TenantTransactionClient,
} from '../../../shared/database/tenant-prisma.service';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { MILLISECONDS_PER_DAY } from '../../../shared/time/time-units';
import { type OpeningHours } from '../../centers/domain/opening-hours';
import { type CenterReportRepository } from '../application/ports/center-report.repository';
import { REPORT_HISTORY_DAYS, type ReportFacts, type ReportSession } from '../domain/center-report';

const TEAM_ROLES = ['owner', 'admin', 'staff'] as const;

interface StoredHoliday {
  readonly date: string;
}

async function findSessions(
  client: TenantTransactionClient,
  since: Date,
): Promise<ReportSession[]> {
  const sessions = await client.classSession.findMany({
    where: {
      status: 'scheduled',
      startsAt: { gte: since },
      bookings: { some: { status: { not: 'cancelled' } } },
    },
    select: {
      serviceId: true,
      staffMembershipId: true,
      startsAt: true,
      endsAt: true,
      bookings: {
        where: { status: { not: 'cancelled' } },
        select: { status: true, clientMembershipId: true },
      },
    },
  });
  return sessions.map((session) => ({
    ...session,
    bookings: session.bookings.flatMap(({ status, clientMembershipId }) =>
      status === 'cancelled' ? [] : [{ status, clientMembershipId }],
    ),
  }));
}

async function findTeam(client: TenantTransactionClient) {
  return client.membership.findMany({
    where: { status: 'active', role: { in: [...TEAM_ROLES] } },
    select: {
      id: true,
      user: { select: { fullName: true } },
      serviceAssignments: {
        where: { service: { archivedAt: null } },
        select: { serviceId: true },
      },
    },
  });
}

@Injectable()
export class PrismaCenterReportRepository implements CenterReportRepository {
  constructor(private readonly tenantPrismaService: TenantPrismaService) {}

  async findFacts(actor: ActorContext, now: Date): Promise<ReportFacts> {
    const since = new Date(now.getTime() - REPORT_HISTORY_DAYS * MILLISECONDS_PER_DAY);
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const center = await client.center.findFirstOrThrow({
        select: { timezone: true, openingHours: true, holidays: true },
      });
      const services = await client.service.findMany({
        select: { id: true, name: true, priceCents: true, _count: { select: { staff: true } } },
      });
      const team = await findTeam(client);
      const clients = await client.membership.findMany({
        where: { role: 'client', status: 'active' },
        select: { id: true, joinedAt: true },
      });

      return {
        now,
        timeZone: center.timezone,
        // Escrito por esta API tras validarlo con zod (ajustes del centro).
        openingHours: center.openingHours as OpeningHours | null,
        holidayDates: ((center.holidays ?? []) as unknown as StoredHoliday[]).map(
          ({ date }) => date,
        ),
        bookableStaffCount: team.filter(({ serviceAssignments }) => serviceAssignments.length > 0)
          .length,
        services: services.map((service) => ({
          id: service.id,
          name: service.name,
          priceCents: service.priceCents,
          staffCount: service._count.staff,
        })),
        staff: team.map(({ id, user }) => ({ membershipId: id, fullName: user.fullName })),
        clients: clients.map(({ id, joinedAt }) => ({ membershipId: id, joinedAt })),
        sessions: await findSessions(client, since),
      };
    });
  }
}
