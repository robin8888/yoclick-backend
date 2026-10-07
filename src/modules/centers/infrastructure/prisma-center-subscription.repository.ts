import { Injectable } from '@nestjs/common';
import { TenantPrismaService } from '../../../shared/database/tenant-prisma.service';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import {
  type CenterSubscriptionFacts,
  type CenterSubscriptionRepository,
} from '../application/ports/center-subscription.repository';

@Injectable()
export class PrismaCenterSubscriptionRepository implements CenterSubscriptionRepository {
  constructor(private readonly tenantPrismaService: TenantPrismaService) {}

  async find(actor: ActorContext): Promise<CenterSubscriptionFacts> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const center = await client.center.findUniqueOrThrow({
        where: { id: actor.centerId },
        select: { status: true, trialEndsAt: true, maxClients: true },
      });
      const activeClientCount = await client.membership.count({
        where: { role: 'client', status: 'active' },
      });
      return { ...center, activeClientCount };
    });
  }
}
