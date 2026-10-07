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
        select: {
          status: true,
          trialEndsAt: true,
          maxClients: true,
          videoStorageLimitBytes: true,
        },
      });
      const activeClientCount = await client.membership.count({
        where: { role: 'client', status: 'active' },
      });
      const videoStorage = await client.video.aggregate({
        _sum: { sizeBytes: true },
        where: { status: { not: 'failed' } },
      });
      return {
        status: center.status,
        trialEndsAt: center.trialEndsAt,
        maxClients: center.maxClients,
        activeClientCount,
        // Un centro llega como mucho a unos cientos de GB: cabe sin pérdida en un número.
        videoStorageLimitBytes:
          center.videoStorageLimitBytes === null ? null : Number(center.videoStorageLimitBytes),
        videoStorageUsedBytes: Number(videoStorage._sum.sizeBytes ?? BigInt(0)),
      };
    });
  }
}
