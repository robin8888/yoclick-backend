import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { TenantPrismaService } from '../../../shared/database/tenant-prisma.service';
import { toLocalDate, zonedDateTimeToUtc } from '../../../shared/time/zoned-time';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import {
  type CenterSharingRepository,
  type JoinStats,
  type ReplaceJoinCodeOutcome,
} from '../application/ports/center-sharing.repository';

const MONTH_LENGTH = 7;
const UNIQUE_VIOLATION = 'P2002';

@Injectable()
export class PrismaCenterSharingRepository implements CenterSharingRepository {
  constructor(private readonly tenantPrismaService: TenantPrismaService) {}

  async countJoinsThisMonth(actor: ActorContext, now: Date): Promise<JoinStats> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const center = await client.center.findUniqueOrThrow({
        where: { id: actor.centerId },
        select: { timezone: true },
      });
      const month = toLocalDate(now, center.timezone).slice(0, MONTH_LENGTH);
      const monthStart = zonedDateTimeToUtc(`${month}-01`, '00:00', center.timezone);
      const grouped = await client.membership.groupBy({
        by: ['joinSource'],
        where: { centerId: actor.centerId, role: 'client', joinedAt: { gte: monthStart } },
        _count: { _all: true },
      });
      const countOf = (source: string | null): number =>
        grouped.find((group) => group.joinSource === source)?._count._all ?? 0;
      return {
        month,
        qr: countOf('qr'),
        link: countOf('link'),
        code: countOf('code'),
        search: countOf('search'),
        total: grouped.reduce((sum, group) => sum + group._count._all, 0),
      };
    });
  }

  async replaceJoinCode(actor: ActorContext, newJoinCode: string): Promise<ReplaceJoinCodeOutcome> {
    try {
      await this.tenantPrismaService.runInTenantContext(actor, (client) =>
        client.center.update({ where: { id: actor.centerId }, data: { joinCode: newJoinCode } }),
      );
      return 'replaced';
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_VIOLATION
      ) {
        return 'code_taken';
      }
      throw error;
    }
  }
}
