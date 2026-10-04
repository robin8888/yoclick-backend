import { Injectable } from '@nestjs/common';
import { TenantPrismaService } from '../../../shared/database/tenant-prisma.service';
import {
  type CenterBranding,
  type CenterBrandingRepository,
} from '../application/get-center-branding.use-case';

@Injectable()
export class PrismaCenterBrandingRepository implements CenterBrandingRepository {
  constructor(private readonly tenantPrismaService: TenantPrismaService) {}

  async findBranding(centerId: string): Promise<CenterBranding | null> {
    const center = await this.tenantPrismaService.runInCenterLookupContext({ centerId }, (client) =>
      client.center.findUnique({
        where: { id: centerId },
        select: { id: true, name: true, sectorId: true, brandColor: true, status: true },
      }),
    );
    if (!center || center.status === 'suspended') return null;
    return {
      centerId: center.id,
      name: center.name,
      sectorId: center.sectorId,
      brandColor: center.brandColor,
    };
  }
}
