import { v7 as generateUuidV7 } from 'uuid';
import { type TenantTransactionClient } from '../../../shared/database/tenant-prisma.service';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { toLocalDate } from '../../../shared/time/zoned-time';
import {
  type RecordCompletionOutcome,
  type RoutineCompletionView,
  type RoutineCompletionSummary,
  type RoutineProgressPerson,
} from '../application/ports/routine.repository';

/** La rutina tiene que ser de esta persona: asignada a ella o a su grupo, y no archivada. */
async function findAssignedRoutine(
  client: TenantTransactionClient,
  actor: ActorContext,
  routineId: string,
): Promise<{ id: string; itemCount: number } | null> {
  const me = await client.membership.findUniqueOrThrow({
    where: { id: actor.membershipId },
    select: { groupId: true },
  });
  const routine = await client.routine.findFirst({
    where: {
      id: routineId,
      archivedAt: null,
      assignments: {
        some: {
          OR: [
            { clientMembershipId: actor.membershipId },
            ...(me.groupId ? [{ groupId: me.groupId }] : []),
          ],
        },
      },
    },
    select: { id: true, _count: { select: { items: true } } },
  });
  return routine ? { id: routine.id, itemCount: routine._count.items } : null;
}

interface NewCompletion {
  readonly routineId: string;
  readonly completedOn: string;
  readonly completedItemCount: number;
  readonly totalItemCount: number;
  readonly completedAt: Date;
}

/** Inserta sin duplicar: un segundo toque el mismo día devuelve lo que ya estaba. */
async function insertOrFindCompletion(
  client: TenantTransactionClient,
  actor: ActorContext,
  completion: NewCompletion,
): Promise<{ isNew: boolean; stored: RoutineCompletionView }> {
  const created = await client.routineCompletion.createMany({
    data: [
      {
        id: generateUuidV7(),
        centerId: actor.centerId,
        clientMembershipId: actor.membershipId,
        ...completion,
      },
    ],
    skipDuplicates: true,
  });
  const stored = await client.routineCompletion.findUniqueOrThrow({
    where: {
      routineId_clientMembershipId_completedOn: {
        routineId: completion.routineId,
        clientMembershipId: actor.membershipId,
        completedOn: completion.completedOn,
      },
    },
  });
  return {
    isNew: created.count === 1,
    stored: {
      completedAt: stored.completedAt,
      completedItemCount: stored.completedItemCount,
      totalItemCount: stored.totalItemCount,
    },
  };
}

export async function recordCompletionInTransaction(
  client: TenantTransactionClient,
  actor: ActorContext,
  request: { routineId: string; completedItemCount: number; now: Date },
): Promise<RecordCompletionOutcome> {
  const routine = await findAssignedRoutine(client, actor, request.routineId);
  if (!routine) return { kind: 'not_found' };
  const isCountValid =
    request.completedItemCount >= 1 && request.completedItemCount <= routine.itemCount;
  if (!isCountValid) return { kind: 'invalid_count' };

  const center = await client.center.findFirstOrThrow({ select: { timezone: true } });
  const { isNew, stored } = await insertOrFindCompletion(client, actor, {
    routineId: routine.id,
    completedOn: toLocalDate(request.now, center.timezone),
    completedItemCount: request.completedItemCount,
    totalItemCount: routine.itemCount,
    completedAt: request.now,
  });
  return { kind: isNew ? 'recorded' : 'already_recorded', completion: stored };
}

/** Cuántas veces ha hecho cada rutina esta persona, la última vez y si ya la hizo hoy. */
export async function summarizeCompletions(
  client: TenantTransactionClient,
  actor: ActorContext,
  routineIds: readonly string[],
): Promise<Map<string, RoutineCompletionSummary>> {
  const summaries = new Map<string, RoutineCompletionSummary>();
  if (routineIds.length === 0) return summaries;
  const center = await client.center.findFirstOrThrow({ select: { timezone: true } });
  const today = toLocalDate(new Date(), center.timezone);
  const completions = await client.routineCompletion.findMany({
    where: { clientMembershipId: actor.membershipId, routineId: { in: [...routineIds] } },
    select: { routineId: true, completedAt: true, completedOn: true },
    orderBy: { completedAt: 'asc' },
  });
  for (const { routineId, completedAt, completedOn } of completions) {
    const previous = summaries.get(routineId);
    summaries.set(routineId, {
      completionCount: (previous?.completionCount ?? 0) + 1,
      lastCompletedAt: completedAt,
      isCompletedToday: previous?.isCompletedToday === true || completedOn === today,
    });
  }
  return summaries;
}

/** Quién tiene la rutina: las personas asignadas directamente y las activas de los grupos asignados. */
async function listAssignedClients(
  client: TenantTransactionClient,
  routineId: string,
): Promise<{ membershipId: string; fullName: string }[]> {
  const assignments = await client.routineAssignment.findMany({
    where: { routineId },
    select: { clientMembershipId: true, groupId: true },
  });
  const directIds = assignments.flatMap(({ clientMembershipId }) =>
    clientMembershipId === null ? [] : [clientMembershipId],
  );
  const groupIds = assignments.flatMap(({ groupId }) => (groupId === null ? [] : [groupId]));
  const members = await client.membership.findMany({
    where: {
      role: 'client',
      status: 'active',
      OR: [{ id: { in: directIds } }, { groupId: { in: groupIds } }],
    },
    select: { id: true, user: { select: { fullName: true } } },
  });
  return members.map(({ id, user }) => ({ membershipId: id, fullName: user.fullName }));
}

/** `null` si la rutina no existe o está archivada. */
export async function listProgressInTransaction(
  client: TenantTransactionClient,
  routineId: string,
): Promise<RoutineProgressPerson[] | null> {
  const routine = await client.routine.findFirst({
    where: { id: routineId, archivedAt: null },
    select: { id: true },
  });
  if (!routine) return null;
  const people = await listAssignedClients(client, routineId);
  const totals = await client.routineCompletion.groupBy({
    by: ['clientMembershipId'],
    where: { routineId },
    _count: { _all: true },
    _max: { completedAt: true },
  });
  const totalsByPerson = new Map(totals.map((row) => [row.clientMembershipId, row]));
  return people
    .map((person) => {
      const total = totalsByPerson.get(person.membershipId);
      return {
        ...person,
        completionCount: total?._count._all ?? 0,
        lastCompletedAt: total?._max.completedAt ?? null,
      };
    })
    .sort((first, second) => first.fullName.localeCompare(second.fullName, 'es'));
}
