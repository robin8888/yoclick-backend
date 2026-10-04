import { Injectable } from '@nestjs/common';
import { type Membership, type Prisma } from '../../../generated/prisma/client';
import { TenantPrismaService } from '../../../shared/database/tenant-prisma.service';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import {
  type TeamMember,
  type TeamMemberUpdate,
  type TeamRepository,
} from '../application/ports/team.repository';

const WITH_USER = { user: { select: { fullName: true, email: true } } } as const;
const TEAM_ROLES = ['owner', 'admin', 'staff'] as const;

type MembershipWithUser = Membership & { user: { fullName: string; email: string } };

function toTeamMember(membership: MembershipWithUser): TeamMember {
  return {
    membershipId: membership.id,
    userId: membership.userId,
    fullName: membership.user.fullName,
    email: membership.user.email,
    role: membership.role,
    status: membership.status,
    staffTitle: membership.staffTitle,
    // Escrito por esta API tras validarlo contra la lista de permisos conocidos.
    permissions: membership.permissions as string[],
    joinedAt: membership.joinedAt,
  };
}

function toUpdateData(update: TeamMemberUpdate): Prisma.MembershipUpdateInput {
  const sentFields = Object.entries(update).filter(([, value]) => value !== undefined);
  return Object.fromEntries(sentFields);
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
  ): Promise<TeamMember> {
    const member = await this.tenantPrismaService.runInTenantContext(actor, (client) =>
      client.membership.update({
        where: { id: membershipId },
        data: toUpdateData(update),
        include: WITH_USER,
      }),
    );
    return toTeamMember(member);
  }
}
