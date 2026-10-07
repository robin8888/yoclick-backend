import { Injectable } from '@nestjs/common';
import { v7 as generateUuidV7 } from 'uuid';
import {
  TenantPrismaService,
  type TenantTransactionClient,
} from '../../../shared/database/tenant-prisma.service';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import {
  type AssignRoutineOutcome,
  type ClientRoutineView,
  type CreateRoutineOutcome,
  type NewRoutine,
  type RoutineAssignmentView,
  type RoutineDetail,
  type RoutineRepository,
  type RoutineSummary,
} from '../application/ports/routine.repository';
import { type AssignmentTarget } from '../domain/routine-rules';

const ITEM_ORDER = { orderBy: { position: 'asc' } } as const;

interface RoutineRow {
  readonly id: string;
  readonly name: string;
  readonly note: string | null;
  readonly createdAt: Date;
  readonly items: readonly { name: string; category: string | null; prescription: string | null }[];
  readonly assignments: readonly {
    id: string;
    assignedAt: Date;
    client: { user: { fullName: string } } | null;
    group: { name: string } | null;
  }[];
}

const DETAIL_INCLUDE = {
  items: { ...ITEM_ORDER, select: { name: true, category: true, prescription: true } },
  assignments: {
    orderBy: { assignedAt: 'desc' },
    select: {
      id: true,
      assignedAt: true,
      client: { select: { user: { select: { fullName: true } } } },
      group: { select: { name: true } },
    },
  },
} as const;

function toAssignmentView(row: RoutineRow['assignments'][number]): RoutineAssignmentView {
  const isClient = row.client !== null;
  return {
    id: row.id,
    kind: isClient ? 'client' : 'group',
    targetName: row.client?.user.fullName ?? row.group?.name ?? '',
    assignedAt: row.assignedAt,
  };
}

function toDetail(row: RoutineRow): RoutineDetail {
  return {
    id: row.id,
    name: row.name,
    note: row.note,
    items: row.items,
    assignments: row.assignments.map(toAssignmentView),
    createdAt: row.createdAt,
  };
}

async function isValidTarget(
  client: TenantTransactionClient,
  target: AssignmentTarget,
): Promise<boolean> {
  if (target.kind === 'client') {
    return (
      (await client.membership.count({
        where: { id: target.membershipId, role: 'client', status: 'active' },
      })) === 1
    );
  }
  return (
    (await client.clientGroup.count({ where: { id: target.groupId, archivedAt: null } })) === 1
  );
}

function targetColumns(target: AssignmentTarget): {
  clientMembershipId: string | null;
  groupId: string | null;
} {
  return target.kind === 'client'
    ? { clientMembershipId: target.membershipId, groupId: null }
    : { clientMembershipId: null, groupId: target.groupId };
}

@Injectable()
export class PrismaRoutineRepository implements RoutineRepository {
  constructor(private readonly tenantPrismaService: TenantPrismaService) {}

  async create(actor: ActorContext, routine: NewRoutine): Promise<CreateRoutineOutcome> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      if (routine.assignTo && !(await isValidTarget(client, routine.assignTo))) {
        return { kind: 'unknown_target' } as const;
      }
      await client.routine.create({
        data: {
          id: routine.id,
          centerId: actor.centerId,
          name: routine.name,
          note: routine.note,
          createdByMembershipId: actor.membershipId,
          items: {
            create: routine.items.map((item, position) => ({
              id: generateUuidV7(),
              position,
              ...item,
            })),
          },
          ...(routine.assignTo && {
            assignments: {
              create: {
                id: generateUuidV7(),
                centerId: actor.centerId,
                assignedByMembershipId: actor.membershipId,
                ...targetColumns(routine.assignTo),
              },
            },
          }),
        },
      });
      const saved = await client.routine.findUniqueOrThrow({
        where: { id: routine.id },
        include: DETAIL_INCLUDE,
      });
      return { kind: 'created', routine: toDetail(saved) } as const;
    });
  }

  async list(actor: ActorContext): Promise<RoutineSummary[]> {
    const rows = await this.tenantPrismaService.runInTenantContext(actor, (client) =>
      client.routine.findMany({
        where: { archivedAt: null },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          name: true,
          createdAt: true,
          _count: { select: { items: true, assignments: true } },
        },
      }),
    );
    return rows.map(({ _count, ...routine }) => ({
      ...routine,
      itemCount: _count.items,
      assignmentCount: _count.assignments,
    }));
  }

  async find(actor: ActorContext, routineId: string): Promise<RoutineDetail | null> {
    const row = await this.tenantPrismaService.runInTenantContext(actor, (client) =>
      client.routine.findFirst({
        where: { id: routineId, archivedAt: null },
        include: DETAIL_INCLUDE,
      }),
    );
    return row ? toDetail(row) : null;
  }

  async archive(actor: ActorContext, routineId: string): Promise<boolean> {
    const result = await this.tenantPrismaService.runInTenantContext(actor, (client) =>
      client.routine.updateMany({
        where: { id: routineId, archivedAt: null },
        data: { archivedAt: new Date() },
      }),
    );
    return result.count === 1;
  }

  async assign(
    actor: ActorContext,
    request: { routineId: string; assignmentId: string; target: AssignmentTarget },
  ): Promise<AssignRoutineOutcome> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const routine = await client.routine.findFirst({
        where: { id: request.routineId, archivedAt: null },
        select: { id: true },
      });
      if (!routine) return { kind: 'not_found' } as const;
      if (!(await isValidTarget(client, request.target)))
        return { kind: 'unknown_target' } as const;

      const columns = targetColumns(request.target);
      const existing = await client.routineAssignment.count({
        where: { routineId: request.routineId, ...columns },
      });
      if (existing > 0) return { kind: 'already_assigned' } as const;
      await client.routineAssignment.create({
        data: {
          id: request.assignmentId,
          centerId: actor.centerId,
          routineId: request.routineId,
          assignedByMembershipId: actor.membershipId,
          ...columns,
        },
      });
      return { kind: 'assigned', assignmentId: request.assignmentId } as const;
    });
  }

  async unassign(actor: ActorContext, routineId: string, assignmentId: string): Promise<boolean> {
    const result = await this.tenantPrismaService.runInTenantContext(actor, (client) =>
      client.routineAssignment.deleteMany({ where: { id: assignmentId, routineId } }),
    );
    return result.count === 1;
  }

  async listForClient(actor: ActorContext): Promise<ClientRoutineView[]> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const me = await client.membership.findUniqueOrThrow({
        where: { id: actor.membershipId },
        select: { groupId: true },
      });
      const assignments = await client.routineAssignment.findMany({
        where: {
          routine: { archivedAt: null },
          OR: [
            { clientMembershipId: actor.membershipId },
            ...(me.groupId ? [{ groupId: me.groupId }] : []),
          ],
        },
        orderBy: { assignedAt: 'desc' },
        select: {
          assignedAt: true,
          routine: {
            select: {
              id: true,
              name: true,
              note: true,
              items: { ...ITEM_ORDER, select: { name: true, category: true, prescription: true } },
            },
          },
        },
      });
      const seen = new Set<string>();
      return assignments.flatMap(({ assignedAt, routine }) => {
        if (seen.has(routine.id)) return [];
        seen.add(routine.id);
        return [{ ...routine, assignedAt }];
      });
    });
  }
}
