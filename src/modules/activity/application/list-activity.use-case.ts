import { Injectable } from '@nestjs/common';
import { TenantPrismaService } from '../../../shared/database/tenant-prisma.service';
import { type ActorContext } from '../../../shared/tenancy/actor-context';

export interface ActivityView {
  readonly id: string;
  readonly kind: string;
  readonly subject: string | null;
  /** Quien lo hizo; `null` si fue el sistema o esa persona ya no está en el centro. */
  readonly actorName: string | null;
  readonly createdAt: Date;
}

/** Lo último que ha pasado en el centro, lo más reciente primero. */
@Injectable()
export class ListActivityUseCase {
  constructor(private readonly tenantPrismaService: TenantPrismaService) {}

  async execute(actor: ActorContext, limit: number): Promise<ActivityView[]> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const entries = await client.activityLog.findMany({
        where: { centerId: actor.centerId },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });
      const actorIds = [
        ...new Set(entries.flatMap(({ actorMembershipId }) => actorMembershipId ?? [])),
      ];
      const actors = await client.membership.findMany({
        where: { id: { in: actorIds } },
        select: { id: true, user: { select: { fullName: true } } },
      });
      return entries.map((entry) => ({
        id: entry.id,
        kind: entry.kind,
        subject: entry.subject,
        actorName: actors.find(({ id }) => id === entry.actorMembershipId)?.user.fullName ?? null,
        createdAt: entry.createdAt,
      }));
    });
  }
}
