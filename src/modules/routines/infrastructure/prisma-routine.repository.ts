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
  type RoutineChanges,
  type RoutineDetail,
  type RoutineItemView,
  type RoutineRepository,
  type RoutineSummary,
  type UpdateRoutineOutcome,
} from '../application/ports/routine.repository';
import { type RoutineNotificationData } from '../../notifications/domain/notification-rules';
import { VIDEO_SELECT } from '../../videos/infrastructure/video-select';
import { type AssignmentTarget } from '../domain/routine-rules';

const ITEM_ORDER = { orderBy: { position: 'asc' } } as const;
const ITEM_SELECT = {
  name: true,
  category: true,
  prescription: true,
  video: { select: VIDEO_SELECT },
} as const;

interface RoutineRow {
  readonly id: string;
  readonly name: string;
  readonly note: string | null;
  readonly createdAt: Date;
  readonly items: readonly RoutineItemView[];
  readonly assignments: readonly {
    id: string;
    assignedAt: Date;
    client: { user: { fullName: string } } | null;
    group: { name: string } | null;
  }[];
}

const DETAIL_INCLUDE = {
  items: { ...ITEM_ORDER, select: ITEM_SELECT },
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

/** Los vídeos de los ejercicios tienen que existir en este centro (el aislamiento por centro ya filtra el resto). */
async function allVideosExist(
  client: TenantTransactionClient,
  items: readonly { videoId: string | null }[],
): Promise<boolean> {
  const videoIds = new Set(items.flatMap(({ videoId }) => (videoId === null ? [] : [videoId])));
  if (videoIds.size === 0) return true;
  return (await client.video.count({ where: { id: { in: [...videoIds] } } })) === videoIds.size;
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

/** Lo que se guarda al crear: la rutina, sus ejercicios en orden y, si se pidió, su asignación. */
function buildCreateData(actor: ActorContext, routine: NewRoutine) {
  return {
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
  };
}

/** Quién se entera de una rutina asignada: la persona, o todas las activas del grupo; menos quien la asignó. */
async function findRecipientsOfTarget(
  client: TenantTransactionClient,
  target: AssignmentTarget,
  actorMembershipId: string,
): Promise<string[]> {
  if (target.kind === 'client') {
    return target.membershipId === actorMembershipId ? [] : [target.membershipId];
  }
  const members = await client.membership.findMany({
    where: { groupId: target.groupId, role: 'client', status: 'active' },
    select: { id: true },
  });
  return members.map(({ id }) => id).filter((id) => id !== actorMembershipId);
}

interface RoutineNoticeRequest {
  readonly routineName: string;
  readonly targets: readonly AssignmentTarget[];
  readonly kind: 'routine_assigned' | 'routine_updated';
}

/** Cada persona una sola vez, aunque la rutina le llegue directamente y por su grupo. */
async function findDistinctRecipients(
  client: TenantTransactionClient,
  targets: readonly AssignmentTarget[],
  actorMembershipId: string,
): Promise<string[]> {
  const recipients = new Set<string>();
  for (const target of targets) {
    for (const id of await findRecipientsOfTarget(client, target, actorMembershipId)) {
      recipients.add(id);
    }
  }
  return [...recipients];
}

/** Deja el aviso de la rutina; se escribe con el cambio y el envío al móvil ocurre después. */
async function recordRoutineNotices(
  client: TenantTransactionClient,
  actor: ActorContext,
  request: RoutineNoticeRequest,
): Promise<void> {
  const recipients = await findDistinctRecipients(client, request.targets, actor.membershipId);
  if (recipients.length === 0) return;
  const actorMember = await client.membership.findUnique({
    where: { id: actor.membershipId },
    select: { user: { select: { fullName: true } } },
  });
  const noticeData: RoutineNotificationData = {
    routineName: request.routineName,
    actorName: actorMember?.user.fullName ?? '',
  };
  await client.notification.createMany({
    data: recipients.map((recipientMembershipId) => ({
      id: generateUuidV7(),
      centerId: actor.centerId,
      recipientMembershipId,
      kind: request.kind,
      data: noticeData,
    })),
  });
}

/** Los ejercicios se reescriben enteros: borrarlos antes libera las posiciones que vuelven a usarse. */
async function replaceRoutineContent(
  client: TenantTransactionClient,
  routineId: string,
  changes: RoutineChanges,
): Promise<void> {
  await client.routineItem.deleteMany({ where: { routineId } });
  await client.routine.update({
    where: { id: routineId },
    data: {
      name: changes.name,
      note: changes.note,
      items: {
        create: changes.items.map((item, position) => ({
          id: generateUuidV7(),
          position,
          ...item,
        })),
      },
    },
  });
}

/** Avisa a quien tiene la rutina asignada, directamente o por su grupo. */
async function notifyRoutineUpdated(
  client: TenantTransactionClient,
  actor: ActorContext,
  routine: { routineId: string; routineName: string },
): Promise<void> {
  const assignments = await client.routineAssignment.findMany({
    where: { routineId: routine.routineId },
    select: { clientMembershipId: true, groupId: true },
  });
  const targets = assignments.flatMap((assignment): AssignmentTarget[] => {
    if (assignment.clientMembershipId !== null) {
      return [{ kind: 'client', membershipId: assignment.clientMembershipId }];
    }
    return assignment.groupId === null ? [] : [{ kind: 'group', groupId: assignment.groupId }];
  });
  await recordRoutineNotices(client, actor, {
    routineName: routine.routineName,
    targets,
    kind: 'routine_updated',
  });
}

@Injectable()
export class PrismaRoutineRepository implements RoutineRepository {
  constructor(private readonly tenantPrismaService: TenantPrismaService) {}

  async findCenterSectorId(actor: ActorContext): Promise<string> {
    const center = await this.tenantPrismaService.runInTenantContext(actor, (client) =>
      client.center.findUniqueOrThrow({
        where: { id: actor.centerId },
        select: { sectorId: true },
      }),
    );
    return center.sectorId;
  }

  async create(actor: ActorContext, routine: NewRoutine): Promise<CreateRoutineOutcome> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      if (routine.assignTo && !(await isValidTarget(client, routine.assignTo))) {
        return { kind: 'unknown_target' } as const;
      }
      if (!(await allVideosExist(client, routine.items))) return { kind: 'unknown_video' } as const;
      await client.routine.create({ data: buildCreateData(actor, routine) });
      if (routine.assignTo) {
        await recordRoutineNotices(client, actor, {
          routineName: routine.name,
          targets: [routine.assignTo],
          kind: 'routine_assigned',
        });
      }
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

  async update(
    actor: ActorContext,
    routineId: string,
    changes: RoutineChanges,
  ): Promise<UpdateRoutineOutcome> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const current = await client.routine.findFirst({
        where: { id: routineId, archivedAt: null },
        select: { id: true },
      });
      if (!current) return { kind: 'not_found' } as const;
      if (!(await allVideosExist(client, changes.items))) return { kind: 'unknown_video' } as const;
      await replaceRoutineContent(client, routineId, changes);
      await notifyRoutineUpdated(client, actor, { routineId, routineName: changes.name });
      const saved = await client.routine.findUniqueOrThrow({
        where: { id: routineId },
        include: DETAIL_INCLUDE,
      });
      return { kind: 'updated', routine: toDetail(saved) } as const;
    });
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
        select: { id: true, name: true },
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
      await recordRoutineNotices(client, actor, {
        routineName: routine.name,
        targets: [request.target],
        kind: 'routine_assigned',
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
              items: { ...ITEM_ORDER, select: ITEM_SELECT },
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
