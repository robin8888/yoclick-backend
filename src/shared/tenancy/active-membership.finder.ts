import { Injectable } from '@nestjs/common';
import { TenantPrismaService } from '../database/tenant-prisma.service';
import { type MembershipRoleName } from './actor-context';
import { readStoredPermissions, type TeamPermission } from './team-permissions';

export interface ActiveMembership {
  readonly membershipId: string;
  readonly role: MembershipRoleName;
  readonly permissions: readonly TeamPermission[];
}

/**
 * Busca la membresía ACTIVA de una persona en un centro. Se consulta con contexto de usuario (sin
 * centro), que la RLS permite solo sobre las filas de esa propia persona: no hay forma de mirar
 * las membresías de otros.
 */
@Injectable()
export class ActiveMembershipFinder {
  constructor(private readonly tenantPrismaService: TenantPrismaService) {}

  /**
   * El menor al que un tutor representa, si de verdad es su tutor: el enlace lo crea el centro y se
   * lee con el contexto del propio tutor, que la RLS limita a sus enlaces.
   */
  async findChildOfGuardian(guardian: {
    userId: string;
    centerId: string;
    membershipId: string;
    childMembershipId: string;
  }): Promise<ActiveMembership | null> {
    const link = await this.tenantPrismaService.runInTenantContext(
      {
        userId: guardian.userId,
        centerId: guardian.centerId,
        membershipId: guardian.membershipId,
        role: 'client',
        permissions: [],
      },
      (client) =>
        client.guardianLink.findFirst({
          where: {
            guardianMembershipId: guardian.membershipId,
            childMembershipId: guardian.childMembershipId,
            child: { status: 'active', role: 'client' },
          },
          select: { childMembershipId: true },
        }),
    );
    return link ? { membershipId: link.childMembershipId, role: 'client', permissions: [] } : null;
  }

  async find(userId: string, centerId: string): Promise<ActiveMembership | null> {
    const membership = await this.tenantPrismaService.runInUserContext(userId, (client) =>
      client.membership.findFirst({
        where: { userId, centerId, status: 'active' },
        select: { id: true, role: true, permissions: true },
      }),
    );
    return membership
      ? {
          membershipId: membership.id,
          role: membership.role,
          permissions: readStoredPermissions(membership.permissions),
        }
      : null;
  }
}
