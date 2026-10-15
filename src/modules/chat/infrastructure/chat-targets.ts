import { type TenantTransactionClient } from '../../../shared/database/tenant-prisma.service';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { type BroadcastTargetsView } from '../application/ports/chat.repository';

async function listGroups(
  client: TenantTransactionClient,
  actor: ActorContext,
): Promise<BroadcastTargetsView['groups']> {
  const groups = await client.clientGroup.findMany({
    where: {
      archivedAt: null,
      ...(actor.role === 'staff' && { instructorMembershipId: actor.membershipId }),
    },
    select: {
      id: true,
      name: true,
      _count: { select: { members: { where: { status: 'active', role: 'client' } } } },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  return groups.map((group) => ({
    id: group.id,
    name: group.name,
    memberCount: group._count.members,
  }));
}

interface ScheduleRow {
  seriesId: string;
  label: string | null;
  weekday: number;
  startsAtTime: string;
  endsAtTime: string;
  service: { name: string };
  room: { name: string } | null;
}

type ClassView = BroadcastTargetsView['classes'][number];

function startClass(schedule: ScheduleRow, enrolledCount: number): ClassView {
  return {
    seriesId: schedule.seriesId,
    name: schedule.label ?? schedule.service.name,
    roomName: schedule.room?.name ?? null,
    weekdays: [schedule.weekday],
    startsAtTime: schedule.startsAtTime,
    endsAtTime: schedule.endsAtTime,
    enrolledCount,
  };
}

/** Una clase fija ocupa varias filas (una por día): se junta en una sola con sus días. */
function groupBySeries(
  schedules: readonly ScheduleRow[],
  enrolledBySeries: ReadonlyMap<string, number>,
): ClassView[] {
  const bySeries = new Map<string, ClassView>();
  for (const schedule of schedules) {
    const existing = bySeries.get(schedule.seriesId);
    if (existing === undefined) {
      bySeries.set(
        schedule.seriesId,
        startClass(schedule, enrolledBySeries.get(schedule.seriesId) ?? 0),
      );
    } else {
      existing.weekdays.push(schedule.weekday);
    }
  }
  return [...bySeries.values()];
}

async function listClasses(
  client: TenantTransactionClient,
  actor: ActorContext,
): Promise<BroadcastTargetsView['classes']> {
  const schedules = await client.sessionSchedule.findMany({
    where: {
      status: 'active',
      ...(actor.role === 'staff' && { staffMembershipId: actor.membershipId }),
    },
    select: {
      seriesId: true,
      label: true,
      weekday: true,
      startsAtTime: true,
      endsAtTime: true,
      service: { select: { name: true } },
      room: { select: { name: true } },
    },
    orderBy: [{ weekday: 'asc' }, { startsAtTime: 'asc' }, { id: 'asc' }],
  });
  const enrolled = await client.scheduleEnrollment.groupBy({
    by: ['seriesId'],
    where: { status: 'active', seriesId: { in: schedules.map(({ seriesId }) => seriesId) } },
    _count: { _all: true },
  });
  return groupBySeries(schedules, new Map(enrolled.map((row) => [row.seriesId, row._count._all])));
}

/** Los grupos de clientes y las clases fijas a los que quien pregunta puede escribir. */
export async function listBroadcastTargetsInTransaction(
  client: TenantTransactionClient,
  actor: ActorContext,
): Promise<BroadcastTargetsView> {
  return { groups: await listGroups(client, actor), classes: await listClasses(client, actor) };
}
