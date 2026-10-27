import { Injectable } from '@nestjs/common';
import {
  TenantPrismaService,
  type TenantTransactionClient,
} from '../../../shared/database/tenant-prisma.service';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import {
  type CenterSubscriptionFacts,
  type CenterSubscriptionRepository,
} from '../application/ports/center-subscription.repository';

/** Lo que ocupan los vídeos y la galería de fotos del centro. */
async function readStorageUsed(
  client: TenantTransactionClient,
): Promise<{ videoBytes: number; photoBytes: number }> {
  const videoStorage = await client.video.aggregate({
    _sum: { sizeBytes: true },
    where: { status: { not: 'failed' } },
  });
  const galleryPhotos = await client.staffProfilePhoto.aggregate({ _sum: { sizeBytes: true } });
  return {
    videoBytes: Number(videoStorage._sum.sizeBytes ?? BigInt(0)),
    photoBytes: galleryPhotos._sum.sizeBytes ?? 0,
  };
}

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
          planId: true,
          billingPeriod: true,
          graceEndsAt: true,
          stripeSubscriptionId: true,
          maxClients: true,
          videoStorageLimitBytes: true,
          photoStorageLimitBytes: true,
        },
      });
      const activeClientCount = await client.membership.count({
        where: { role: 'client', isStudent: true, status: 'active' },
      });
      const storageUsed = await readStorageUsed(client);
      return {
        status: center.status,
        trialEndsAt: center.trialEndsAt,
        planId: center.planId,
        billingPeriod: center.billingPeriod as 'monthly' | 'annual' | null,
        graceEndsAt: center.graceEndsAt,
        hasSubscription: center.stripeSubscriptionId !== null,
        maxClients: center.maxClients,
        activeClientCount,
        // Un centro llega como mucho a unos cientos de GB: cabe sin pérdida en un número.
        videoStorageLimitBytes:
          center.videoStorageLimitBytes === null ? null : Number(center.videoStorageLimitBytes),
        videoStorageUsedBytes: storageUsed.videoBytes,
        photoStorage: {
          usedBytes: storageUsed.photoBytes,
          limitBytes: Number(center.photoStorageLimitBytes),
        },
      };
    });
  }
}
