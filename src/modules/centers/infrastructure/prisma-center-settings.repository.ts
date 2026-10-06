import { Injectable } from '@nestjs/common';
import { type Center, type Prisma } from '../../../generated/prisma/client';
import { TenantPrismaService } from '../../../shared/database/tenant-prisma.service';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import {
  type CancelPolicy,
  type CenterSettings,
  type CenterSettingsPatch,
  type CenterSettingsRepository,
  type Holiday,
} from '../application/ports/center-settings.repository';
import { type OpeningHours } from '../domain/opening-hours';

/** Lo guardado en las columnas JSON lo escribió esta misma API tras validarlo con zod. */
function toSettings(center: Center): CenterSettings {
  return {
    id: center.id,
    updatedAt: center.updatedAt,
    slug: center.slug,
    name: center.name,
    sectorId: center.sectorId,
    brandColor: center.brandColor,
    timezone: center.timezone,
    joinCode: center.joinCode,
    status: center.status,
    isListed: center.isListed,
    city: center.city,
    address: center.address,
    phone: center.phone,
    contactEmail: center.contactEmail,
    legalName: center.legalName,
    taxId: center.taxId,
    taxAddress: center.taxAddress,
    latitude: center.latitude,
    longitude: center.longitude,
    openingHours: center.openingHours as OpeningHours | null,
    holidays: center.holidays as Holiday[] | null,
    cancelPolicy: center.cancelPolicy as CancelPolicy | null,
    trialEndsAt: center.trialEndsAt,
  };
}

/** Solo los campos enviados: lo que falta no se toca (y `null` sí es un valor: borra el dato). */
function toUpdateData(patch: CenterSettingsPatch): Prisma.CenterUpdateManyMutationInput {
  const sentFields = Object.entries(patch).filter(([, value]) => value !== undefined);
  return Object.fromEntries(sentFields);
}

@Injectable()
export class PrismaCenterSettingsRepository implements CenterSettingsRepository {
  constructor(private readonly tenantPrismaService: TenantPrismaService) {}

  async find(actor: ActorContext): Promise<CenterSettings | null> {
    const center = await this.tenantPrismaService.runInTenantContext(actor, (client) =>
      client.center.findUnique({ where: { id: actor.centerId } }),
    );
    return center ? toSettings(center) : null;
  }

  async updateIfUnchanged(
    actor: ActorContext,
    expectedUpdatedAt: Date,
    patch: CenterSettingsPatch,
  ): Promise<CenterSettings | null> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      // Un solo UPDATE condicionado a la versión leída: si otra petición cambió el centro, no toca nada.
      const result = await client.center.updateMany({
        where: { id: actor.centerId, updatedAt: expectedUpdatedAt },
        data: toUpdateData(patch),
      });
      if (result.count !== 1) return null;
      return toSettings(await client.center.findUniqueOrThrow({ where: { id: actor.centerId } }));
    });
  }
}
