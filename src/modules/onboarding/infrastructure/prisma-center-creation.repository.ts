import { Injectable } from '@nestjs/common';
import { v7 as generateUuidV7 } from 'uuid';
import { Prisma } from '../../../generated/prisma/client';
import { TenantPrismaService } from '../../../shared/database/tenant-prisma.service';
import {
  type CenterCreationRepository,
  type CenterCreationResult,
  type NewCenter,
} from '../application/ports/center-creation.repository';

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === UNIQUE_CONSTRAINT_VIOLATION
  );
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
      await this.tenantPrismaService.runInTenantContext(actor, async (client) => {
        await client.center.create({ data: { ...center, status: 'trial' } });
        await client.membership.create({
          data: {
            id: ownerMembershipId,
            centerId: center.id,
            userId: ownerUserId,
            role: 'owner',
            status: 'active',
          },
        });
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error)) return { kind: 'identifier_taken' };
      throw error;
    }
    return { kind: 'created', ownerMembershipId };
  }
}
