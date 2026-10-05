import { Injectable } from '@nestjs/common';
import { v7 as generateUuidV7 } from 'uuid';
import { Prisma } from '../../../generated/prisma/client';
import {
  TenantPrismaService,
  type TenantTransactionClient,
} from '../../../shared/database/tenant-prisma.service';
import {
  type CenterCreationRepository,
  type CenterCreationResult,
  type NewCenter,
} from '../application/ports/center-creation.repository';
import { provisionCenterDefaults } from './center-defaults.provisioner';

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === UNIQUE_CONSTRAINT_VIOLATION
  );
}

/** Todo en la misma transacción: un centro nunca queda a medias, sin propietario, horario ni servicios. */
async function insertCenterWithOwnerAndDefaults(
  client: TenantTransactionClient,
  center: NewCenter,
  owner: { readonly userId: string; readonly membershipId: string },
): Promise<void> {
  await client.center.create({ data: { ...center, status: 'trial' } });
  await client.membership.create({
    data: {
      id: owner.membershipId,
      centerId: center.id,
      userId: owner.userId,
      role: 'owner',
      status: 'active',
    },
  });
  await provisionCenterDefaults(client, {
    centerId: center.id,
    sectorId: center.sectorId,
    professionalMembershipIds: [owner.membershipId],
  });
}

@Injectable()
export class PrismaCenterCreationRepository implements CenterCreationRepository {
  constructor(private readonly tenantPrismaService: TenantPrismaService) {}

  async createWithOwner(
    center: NewCenter,
    ownerUserId: string,
    maxOwnedCenters: number,
  ): Promise<CenterCreationResult> {
    // Contar con el contexto de la persona: la RLS solo deja ver SUS membresías. No es atómico con
    // la creación, pero el tope es una protección contra abuso, no una regla de negocio exacta.
    const ownedCenterCount = await this.tenantPrismaService.runInUserContext(
      ownerUserId,
      (client) =>
        client.membership.count({
          where: { userId: ownerUserId, role: 'owner', status: 'active' },
        }),
    );
    if (ownedCenterCount >= maxOwnedCenters) return { kind: 'owner_limit_reached' };

    const ownerMembershipId = generateUuidV7();
    const actor = {
      userId: ownerUserId,
      centerId: center.id,
      membershipId: ownerMembershipId,
      role: 'owner',
      permissions: [],
    } as const;
    try {
      await this.tenantPrismaService.runInTenantContext(actor, (client) =>
        insertCenterWithOwnerAndDefaults(client, center, {
          userId: ownerUserId,
          membershipId: ownerMembershipId,
        }),
      );
    } catch (error) {
      if (isUniqueConstraintViolation(error)) return { kind: 'identifier_taken' };
      throw error;
    }
    return { kind: 'created', ownerMembershipId };
  }
}
