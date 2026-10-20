import { Injectable } from '@nestjs/common';
import { resolveCenterModules } from '../../../shared/centers/center-modules';
import { resolveVisibleAppearance } from '../../../shared/centers/center-appearance';
import { buildCenterLogoUrl } from '../../../shared/media/center-logo-url';
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
        select: {
          id: true,
          name: true,
          sectorId: true,
          disabledModules: true,
          brandColor: true,
          logoUpdatedAt: true,
          status: true,
          maxClients: true,
          backgroundColor: true,
          backgroundColorEnd: true,
          hiveColor: true,
        },
      }),
    );
    if (!center || center.status === 'suspended') return null;
    return {
      centerId: center.id,
      name: center.name,
      sectorId: center.sectorId,
      brandColor: center.brandColor,
      logoUrl: buildCenterLogoUrl(center.id, center.logoUpdatedAt),
      modules: resolveCenterModules(center.disabledModules),
      appearance: resolveVisibleAppearance(center),
    };
  }
}
