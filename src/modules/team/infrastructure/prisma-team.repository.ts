import { Injectable } from '@nestjs/common';
import { type Membership, type Prisma } from '../../../generated/prisma/client';
import {
  TenantPrismaService,
  type TenantTransactionClient,
} from '../../../shared/database/tenant-prisma.service';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import {
  type TeamMember,
  type TeamMemberUpdate,
  type TeamRepository,
} from '../application/ports/team.repository';

const WITH_USER = {
  user: { select: { fullName: true, email: true, photoKey: true } },
  serviceAssignments: {
    where: { service: { archivedAt: null } },
    select: { service: { select: { id: true, name: true } } },
  },
} satisfies Prisma.MembershipInclude;
const TEAM_ROLES = ['owner', 'admin', 'staff'] as const;

type MembershipWithUser = Membership & {
  user: { fullName: string; email: string; photoKey: string | null };
  serviceAssignments: { service: { id: string; name: string } }[];
};

function toTeamMember(membership: MembershipWithUser): TeamMember {
  return {
    membershipId: membership.id,
    userId: membership.userId,
    fullName: membership.user.fullName,
    email: membership.user.email,
    photoKey: membership.user.photoKey,
    role: membership.role,
    status: membership.status,
    staffTitle: membership.staffTitle,
    // Escrito por esta API tras validarlo contra la lista de permisos conocidos.
    permissions: membership.permissions as string[],
    services: membership.serviceAssignments.map(({ service }) => service),
    joinedAt: membership.joinedAt,
  };
}

function toUpdateData(update: TeamMemberUpdate): Prisma.MembershipUpdateInput {
  // Los servicios no son un campo de la membresía: se guardan aparte (`replaceServicesOfMember`).
  const sentFields = Object.entries(update).filter(
    ([field, value]) => field !== 'serviceIds' && value !== undefined,
  );
  return Object.fromEntries(sentFields);
}

/** La persona pasa a dar exactamente estos servicios; `false` si alguno no existe en el centro. */
async function replaceServicesOfMember(
  client: TenantTransactionClient,
  membershipId: string,
  serviceIds: readonly string[],
): Promise<boolean> {
  const uniqueIds = [...new Set(serviceIds)];
  const existing = await client.service.count({
    where: { id: { in: uniqueIds }, archivedAt: null },
  });
  if (existing !== uniqueIds.length) return false;
  await client.serviceStaff.deleteMany({ where: { membershipId } });
  await client.serviceStaff.createMany({
    data: uniqueIds.map((serviceId) => ({ serviceId, membershipId })),
  });
  return true;
}

@Injectable()
export class PrismaTeamRepository implements TeamRepository {
  constructor(private readonly tenantPrismaService: TenantPrismaService) {}

  async listTeam(actor: ActorContext): Promise<TeamMember[]> {
    const members = await this.tenantPrismaService.runInTenantContext(actor, (client) =>
      client.membership.findMany({
        where: { role: { in: [...TEAM_ROLES] }, status: { not: 'left' } },
        include: WITH_USER,
        orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
      }),
    );
    return members.map(toTeamMember);
  }

  async findMember(actor: ActorContext, membershipId: string): Promise<TeamMember | null> {
    const member = await this.tenantPrismaService.runInTenantContext(actor, (client) =>
      client.membership.findUnique({ where: { id: membershipId }, include: WITH_USER }),
    );
    return member ? toTeamMember(member) : null;
  }

  async updateMember(
    actor: ActorContext,
    membershipId: string,
    update: TeamMemberUpdate,
  ): Promise<TeamMember | null> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      if (
        update.serviceIds !== undefined &&
        !(await replaceServicesOfMember(client, membershipId, update.serviceIds))
      ) {
        return null;
      }
      const member = await client.membership.update({
        where: { id: membershipId },
        data: toUpdateData(update),
        include: WITH_USER,
      });
      return toTeamMember(member);
    });
  }
}
