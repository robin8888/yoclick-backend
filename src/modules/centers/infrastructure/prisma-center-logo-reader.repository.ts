import { Injectable } from '@nestjs/common';
import { TenantPrismaService } from '../../../shared/database/tenant-prisma.service';
import {
  type CenterLogoReader,
  type StoredCenterLogo,
} from '../application/ports/center-logo-reader.repository';

@Injectable()
export class PrismaCenterLogoReader implements CenterLogoReader {
  constructor(private readonly tenantPrismaService: TenantPrismaService) {}

  async findPublicLogo(centerId: string): Promise<StoredCenterLogo | null> {
    const center = await this.tenantPrismaService.runInCenterLookupContext({ centerId }, (client) =>
      client.center.findUnique({
        where: { id: centerId },
        select: { status: true, logo: true },
      }),
    );
    if (!center?.logo || center.status === 'suspended') return null;
    return {
      contentType: center.logo.contentType,
      bytes: Buffer.from(center.logo.data),
      sha256: center.logo.sha256,
    };
  }
}
