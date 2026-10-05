import { v7 as generateUuidV7 } from 'uuid';
import { Prisma } from '../../../generated/prisma/client';
import { type TenantTransactionClient } from '../../../shared/database/tenant-prisma.service';
import { DEFAULT_OPENING_HOURS } from '../domain/default-opening-hours';
import { suggestServicesForSector } from '../domain/sector-service-suggestions';

export interface CenterDefaultsRequest {
  readonly centerId: string;
  readonly sectorId: string;
  /** Quienes atenderán los servicios sugeridos (al crear el centro, solo su propietario). */
  readonly professionalMembershipIds: readonly string[];
}

export interface CenterDefaultsOutcome {
  readonly hasAppliedOpeningHours: boolean;
  readonly createdServiceCount: number;
}

/**
 * Deja un centro listo para reservar: horario semanal si no tiene ninguno y los servicios sugeridos
 * de su sector si no tiene ningún servicio (archivados incluidos: quien archivó todos no quiere que
 * reaparezcan). Idempotente, así que sirve igual al crear un centro, al sembrar la demo y al
 * rellenar los centros anteriores a esta función. Debe ejecutarse dentro de la transacción de
 * tenant del propio centro.
 */
export async function provisionCenterDefaults(
  client: TenantTransactionClient,
  request: CenterDefaultsRequest,
): Promise<CenterDefaultsOutcome> {
  const hasAppliedOpeningHours = await applyDefaultOpeningHours(client, request.centerId);
  const createdServiceCount = await createSuggestedServices(client, request);
  return { hasAppliedOpeningHours, createdServiceCount };
}

async function applyDefaultOpeningHours(
  client: TenantTransactionClient,
  centerId: string,
): Promise<boolean> {
  // `updateMany` condicionado a "sin horario": dos ejecuciones a la vez no se pisan.
  const result = await client.center.updateMany({
    where: { id: centerId, openingHours: { equals: Prisma.DbNull } },
    // Un objeto JSON plano que construimos nosotros: el tipo de Prisma no admite `readonly`.
    data: { openingHours: DEFAULT_OPENING_HOURS as Prisma.InputJsonObject },
  });
  return result.count === 1;
}

async function createSuggestedServices(
  client: TenantTransactionClient,
  request: CenterDefaultsRequest,
): Promise<number> {
  const existingServiceCount = await client.service.count({
    where: { centerId: request.centerId },
  });
  if (existingServiceCount > 0) return 0;

  const services = suggestServicesForSector(request.sectorId).map((suggestion, sortOrder) => ({
    id: generateUuidV7(),
    centerId: request.centerId,
    name: suggestion.name,
    durationMinutes: suggestion.durationMinutes,
    sortOrder,
  }));
  await client.service.createMany({ data: services });
  await client.serviceStaff.createMany({
    data: services.flatMap((service) =>
      request.professionalMembershipIds.map((membershipId) => ({
        serviceId: service.id,
        membershipId,
      })),
    ),
  });
  return services.length;
}
