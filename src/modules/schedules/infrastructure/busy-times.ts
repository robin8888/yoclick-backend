import { type TenantTransactionClient } from '../../../shared/database/tenant-prisma.service';
import { type BusyTimeView } from '../application/ports/schedule.repository';
import { toDateColumn } from './schedule-materialization';

const ISO_DATE_LENGTH = 'YYYY-MM-DD'.length;

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, ISO_DATE_LENGTH);
}

/**
 * Las clases activas de una sala y/o de un profesor, con la franja de la semana que ocupan: lo que
 * la pantalla de «crear clase» no deja elegir. `today` es el día local del centro (`YYYY-MM-DD` o
 * `Date`), para no contar las clases que ya terminaron.
 */
export async function findBusyTimes(
  client: TenantTransactionClient,
  query: { roomId: string | null; staffMembershipId: string | null; today: string | Date },
): Promise<BusyTimeView[]> {
  const today = typeof query.today === 'string' ? toDateColumn(query.today) : query.today;
  const owners = [
    ...(query.roomId === null ? [] : [{ roomId: query.roomId }]),
    ...(query.staffMembershipId === null ? [] : [{ staffMembershipId: query.staffMembershipId }]),
  ];
  if (owners.length === 0) return [];
  const rows = await client.sessionSchedule.findMany({
    where: {
      status: 'active',
      AND: [{ OR: owners }, { OR: [{ endsOn: null }, { endsOn: { gte: today } }] }],
    },
    select: {
      weekday: true,
      startsAtTime: true,
      endsAtTime: true,
      roomId: true,
      label: true,
      startsOn: true,
      endsOn: true,
      service: { select: { name: true } },
    },
    orderBy: [{ weekday: 'asc' }, { startsAtTime: 'asc' }, { id: 'asc' }],
  });
  return rows.map((row) => ({
    weekday: row.weekday,
    startsAtTime: row.startsAtTime,
    endsAtTime: row.endsAtTime,
    source: row.roomId !== null && row.roomId === query.roomId ? 'room' : 'teacher',
    className: row.label ?? row.service.name,
    startsOn: toIsoDate(row.startsOn),
    endsOn: row.endsOn === null ? null : toIsoDate(row.endsOn),
  }));
}
