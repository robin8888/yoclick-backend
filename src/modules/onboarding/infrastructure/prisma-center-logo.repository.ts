import { Injectable } from '@nestjs/common';
import { TenantPrismaService } from '../../../shared/database/tenant-prisma.service';
import {
  type CenterLogoRepository,
  type CenterLogoSaveResult,
  type NewCenterLogo,
} from '../application/ports/center-logo.repository';

@Injectable()
export class PrismaCenterLogoRepository implements CenterLogoRepository {
  constructor(private readonly tenantPrismaService: TenantPrismaService) {}

  async saveForOwner(
    ownerUserId: string,
    centerId: string,
    logo: NewCenterLogo,
  ): Promise<CenterLogoSaveResult> {
    // Con el contexto de la persona la RLS solo deja ver SUS membresías: un centro ajeno o
    // inexistente es indistinguible de uno donde no es propietaria.
    const ownerMembership = await this.tenantPrismaService.runInUserContext(ownerUserId, (client) =>
      client.membership.findFirst({
        where: { userId: ownerUserId, centerId, role: 'owner', status: 'active' },
        select: { id: true },
      }),
    );
    if (!ownerMembership) return { kind: 'not_owner' };

    const actor = {
      userId: ownerUserId,
      centerId,
      membershipId: ownerMembership.id,
      role: 'owner',
      permissions: [],
    } as const;
    await this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const logoFields = {
        contentType: logo.contentType,
        data: new Uint8Array(logo.bytes),
        sha256: logo.sha256,
        updatedAt: logo.uploadedAt,
      };
      await client.centerLogo.upsert({
        where: { centerId },
        create: { centerId, ...logoFields },
        update: logoFields,
      });
      await client.center.update({
        where: { id: centerId },
        data: { logoUpdatedAt: logo.uploadedAt },
      });
    });
    return { kind: 'saved' };
  }
}
