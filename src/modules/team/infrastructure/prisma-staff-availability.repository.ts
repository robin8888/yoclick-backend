import { Injectable } from '@nestjs/common';
import { type Prisma } from '../../../generated/prisma/client';
import { TenantPrismaService } from '../../../shared/database/tenant-prisma.service';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { getUtcRangeOfLocalDates } from '../../../shared/time/zoned-time';
import { type OpeningHours, WEEKDAYS } from '../../centers/domain/opening-hours';
import {
  type AbsenceView,
  type NewAbsence,
  type StaffAvailabilityRepository,
  type StaffAvailabilityView,
} from '../application/ports/staff-availability.repository';

const TEAM_ROLES = ['owner', 'admin', 'staff'] as const;
const UTC_MIDNIGHT_SUFFIX = 'T00:00:00Z';
const ISO_DATE_LENGTH = 10;

/** La respuesta lleva siempre los siete días: uno sin tramos es un día que no trabaja. */
function fillMissingDays(hours: OpeningHours): OpeningHours {
  return Object.fromEntries(WEEKDAYS.map((weekday) => [weekday, hours[weekday] ?? []]));
}

const toDateOnly = (value: Date): string => value.toISOString().slice(0, ISO_DATE_LENGTH);
const fromDateOnly = (value: string): Date => new Date(value + UTC_MIDNIGHT_SUFFIX);

@Injectable()
export class PrismaStaffAvailabilityRepository implements StaffAvailabilityRepository {
  constructor(private readonly tenantPrismaService: TenantPrismaService) {}

  async findAvailability(
    actor: ActorContext,
    membershipId: string,
  ): Promise<StaffAvailabilityView | null> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const member = await client.membership.findFirst({
        where: { id: membershipId, status: 'active', role: { in: [...TEAM_ROLES] } },
        select: {
          availability: { select: { weeklyHours: true } },
          absences: { orderBy: { startsOn: 'asc' } },
        },
      });
      if (!member) return null;
      return {
        // Escrito por esta API tras validarlo con zod (disponibilidad del equipo).
        weeklyHours: member.availability
          ? fillMissingDays(member.availability.weeklyHours as OpeningHours)
          : null,
        absences: member.absences.map(({ id, startsOn, endsOn, reason }): AbsenceView => ({
          id,
          startsOn: toDateOnly(startsOn),
          endsOn: toDateOnly(endsOn),
          reason,
        })),
      };
    });
  }

  async saveWeeklyHours(
    actor: ActorContext,
    membershipId: string,
    weeklyHours: OpeningHours | null,
  ): Promise<void> {
    await this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      if (weeklyHours === null) {
        await client.staffAvailability.deleteMany({ where: { membershipId } });
        return;
      }
      // Validado con zod en la frontera: tiene forma de objeto JSON.
      const storedHours = weeklyHours as unknown as Prisma.InputJsonObject;
      await client.staffAvailability.upsert({
        where: { membershipId },
        create: { membershipId, centerId: actor.centerId, weeklyHours: storedHours },
        update: { weeklyHours: storedHours },
      });
    });
  }

  async addAbsence(
    actor: ActorContext,
    absence: NewAbsence,
  ): Promise<{ affectedBookingCount: number }> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      await client.staffAbsence.create({
        data: {
          id: absence.id,
          centerId: actor.centerId,
          membershipId: absence.membershipId,
          startsOn: fromDateOnly(absence.startsOn),
          endsOn: fromDateOnly(absence.endsOn),
          reason: absence.reason,
        },
      });
      const center = await client.center.findFirstOrThrow({ select: { timezone: true } });
      const range = getUtcRangeOfLocalDates(absence.startsOn, absence.endsOn, center.timezone);
      const affectedBookingCount = await client.booking.count({
        where: {
          status: { not: 'cancelled' },
          classSession: {
            status: 'scheduled',
            staffMembershipId: absence.membershipId,
            startsAt: { gte: range.startsAt, lt: range.endsAt },
          },
        },
      });
      return { affectedBookingCount };
    });
  }

  async removeAbsence(
    actor: ActorContext,
    membershipId: string,
    absenceId: string,
  ): Promise<boolean> {
    const result = await this.tenantPrismaService.runInTenantContext(actor, (client) =>
      client.staffAbsence.deleteMany({ where: { id: absenceId, membershipId } }),
    );
    return result.count === 1;
  }
}
