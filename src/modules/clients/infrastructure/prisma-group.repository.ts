import { Injectable } from '@nestjs/common';
import { v7 as generateUuidV7 } from 'uuid';
import { type Prisma } from '../../../generated/prisma/client';
import {
  TenantPrismaService,
  type TenantTransactionClient,
} from '../../../shared/database/tenant-prisma.service';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import {
  type GroupCreationOutcome,
  type GroupRepository,
  type GroupView,
  type NewGroup,
} from '../application/ports/group.repository';
import { MAX_GROUPS_PER_CENTER } from '../domain/client-rules';

const TEAM_ROLES = ['owner', 'admin', 'staff'] as const;

const WITH_INSTRUCTOR = {
  instructor: {
    select: { id: true, user: { select: { fullName: true } } },
  },
  _count: { select: { members: true } },
} satisfies Prisma.ClientGroupInclude;

type GroupWithInstructor = Prisma.ClientGroupGetPayload<{ include: typeof WITH_INSTRUCTOR }>;

function toGroupView(group: GroupWithInstructor): GroupView {
  return {
    id: group.id,
    name: group.name,
    level: group.level,
    instructor: group.instructor
      ? { membershipId: group.instructor.id, fullName: group.instructor.user.fullName }
      : null,
    memberCount: group._count.members,
  };
}

async function isActiveTeamMember(
  client: TenantTransactionClient,
  membershipId: string,
): Promise<boolean> {
  const count = await client.membership.count({
    where: { id: membershipId, status: 'active', role: { in: [...TEAM_ROLES] } },
  });
  return count === 1;
}

async function findCreationBlocker(
  client: TenantTransactionClient,
  newGroup: NewGroup,
): Promise<GroupCreationOutcome | null> {
  const activeGroupCount = await client.clientGroup.count({ where: { archivedAt: null } });
  if (activeGroupCount >= MAX_GROUPS_PER_CENTER) return { kind: 'limit_reached' };
  const sameName = await client.clientGroup.count({
    where: { archivedAt: null, name: { equals: newGroup.name, mode: 'insensitive' } },
  });
  if (sameName > 0) return { kind: 'duplicate_name' };
  const hasInvalidInstructor =
    newGroup.instructorMembershipId !== null &&
    !(await isActiveTeamMember(client, newGroup.instructorMembershipId));
  return hasInvalidInstructor ? { kind: 'unknown_instructor' } : null;
}

@Injectable()
export class PrismaGroupRepository implements GroupRepository {
  constructor(private readonly tenantPrismaService: TenantPrismaService) {}

  async listGroups(actor: ActorContext): Promise<GroupView[]> {
    const groups = await this.tenantPrismaService.runInTenantContext(actor, (client) =>
      client.clientGroup.findMany({
        where: { archivedAt: null },
        include: WITH_INSTRUCTOR,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
    );
    return groups.map(toGroupView);
  }

  async createGroup(actor: ActorContext, newGroup: NewGroup): Promise<GroupCreationOutcome> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const blocker = await findCreationBlocker(client, newGroup);
      if (blocker) return blocker;
      const group = await client.clientGroup.create({
        data: { id: generateUuidV7(), centerId: actor.centerId, ...newGroup },
        include: WITH_INSTRUCTOR,
      });
      return { kind: 'created', group: toGroupView(group) };
    });
  }

  async archiveGroup(actor: ActorContext, groupId: string): Promise<boolean> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const archived = await client.clientGroup.updateMany({
        where: { id: groupId, archivedAt: null },
        data: { archivedAt: new Date() },
      });
      if (archived.count !== 1) return false;
      await client.membership.updateMany({ where: { groupId }, data: { groupId: null } });
      return true;
    });
  }
}
