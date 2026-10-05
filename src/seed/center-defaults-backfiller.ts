import { Injectable } from '@nestjs/common';
import { TenantPrismaService } from '../shared/database/tenant-prisma.service';
import { provisionCenterDefaults } from '../modules/onboarding/infrastructure/center-defaults.provisioner';

export interface BackfillSummary {
  readonly centerCount: number;
  readonly centersWithNewServices: number;
  readonly centersWithNewOpeningHours: number;
  readonly createdServiceCount: number;
}

interface OwnerMembership {
  readonly membershipId: string;
  readonly userId: string;
  readonly centerId: string;
  readonly joinedAt: Date;
}

/**
 * Rellena los centros creados antes de existir los servicios: horario por defecto si no tienen
 * ninguno y los servicios sugeridos de su sector si no tienen ningún servicio, atendidos por su
 * propietario. Idempotente: no toca a un centro que ya tiene horario ni servicios.
 *
 * Con RLS no hay forma de listar "todos los centros" sin un contexto, así que se parte de las
 * personas (la tabla `users` no tiene RLS) y de sus membresías de propietario. Pensado para
 * desarrollo y para bases pequeñas, no como tarea recurrente en producción.
 */
@Injectable()
export class CenterDefaultsBackfiller {
  constructor(private readonly tenantPrismaService: TenantPrismaService) {}

  async run(): Promise<BackfillSummary> {
    const firstOwnerByCenter = await this.findFirstOwnerOfEachCenter();
    let centersWithNewServices = 0;
    let centersWithNewOpeningHours = 0;
    let createdServiceCount = 0;

    for (const owner of firstOwnerByCenter.values()) {
      const outcome = await this.provisionCenter(owner);
      createdServiceCount += outcome.createdServiceCount;
      if (outcome.createdServiceCount > 0) centersWithNewServices += 1;
      if (outcome.hasAppliedOpeningHours) centersWithNewOpeningHours += 1;
    }
    return {
      centerCount: firstOwnerByCenter.size,
      centersWithNewServices,
      centersWithNewOpeningHours,
      createdServiceCount,
    };
  }

  private async findFirstOwnerOfEachCenter(): Promise<Map<string, OwnerMembership>> {
    const users = await this.tenantPrismaService.runInPublicContext((client) =>
      client.user.findMany({ where: { deletedAt: null }, select: { id: true } }),
    );
    const firstOwnerByCenter = new Map<string, OwnerMembership>();
    for (const { id: userId } of users) {
      const ownedMemberships = await this.tenantPrismaService.runInUserContext(userId, (client) =>
        client.membership.findMany({
          where: { userId, role: 'owner', status: 'active' },
          select: { id: true, centerId: true, joinedAt: true },
        }),
      );
      for (const membership of ownedMemberships) {
        const current = firstOwnerByCenter.get(membership.centerId);
        if (current && current.joinedAt <= membership.joinedAt) continue;
        firstOwnerByCenter.set(membership.centerId, {
          membershipId: membership.id,
          userId,
          centerId: membership.centerId,
          joinedAt: membership.joinedAt,
        });
      }
    }
    return firstOwnerByCenter;
  }

  private async provisionCenter(owner: OwnerMembership) {
    const actor = {
      userId: owner.userId,
      centerId: owner.centerId,
      membershipId: owner.membershipId,
      role: 'owner',
      permissions: [],
    } as const;
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const center = await client.center.findUniqueOrThrow({
        where: { id: owner.centerId },
        select: { sectorId: true },
      });
      return provisionCenterDefaults(client, {
        centerId: owner.centerId,
        sectorId: center.sectorId,
        professionalMembershipIds: [owner.membershipId],
      });
    });
  }
}
