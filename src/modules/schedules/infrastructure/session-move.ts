import { type TenantTransactionClient } from '../../../shared/database/tenant-prisma.service';
import { toLocationColumns } from '../../../shared/location/session-location';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { zonedDateTimeToUtc } from '../../../shared/time/zoned-time';
import {
  type MoveSessionOutcome,
  type SessionMove,
} from '../application/ports/schedule.repository';
import { recordSessionMovedNotices } from './schedule-notices';
import { loadCenterCalendar } from './schedule-materialization';

const MOVABLE_SESSION_INCLUDE = {
  service: { select: { name: true } },
  staffMembership: { select: { user: { select: { fullName: true } } } },
  bookings: { where: { status: 'confirmed' }, select: { clientMembershipId: true } },
} as const;

interface SessionPlace {
  readonly id: string;
  readonly roomId: string | null;
  readonly staffMembershipId: string | null;
}

interface TimeRange {
  readonly startsAt: Date;
  readonly endsAt: Date;
}

/** Otra sesión programada que usa la misma sala o al mismo profesor en ese tramo. */
async function findPlaceConflict(
  client: TenantTransactionClient,
  session: SessionPlace,
  range: TimeRange,
): Promise<'room_overlap' | 'teacher_overlap' | null> {
  const overlapping = {
    id: { not: session.id },
    status: 'scheduled' as const,
    startsAt: { lt: range.endsAt },
    endsAt: { gt: range.startsAt },
  };
  if (session.roomId !== null) {
    const roomCount = await client.classSession.count({
      where: { ...overlapping, roomId: session.roomId },
    });
    if (roomCount > 0) return 'room_overlap';
  }
  if (session.staffMembershipId === null) return null;
  const teacherCount = await client.classSession.count({
    where: { ...overlapping, staffMembershipId: session.staffMembershipId },
  });
  return teacherCount > 0 ? 'teacher_overlap' : null;
}

/** Quien tiene plaza y ya tiene otra cita en el nuevo tramo (la propia sesión no cuenta). */
async function isAnyAttendeeBusy(
  client: TenantTransactionClient,
  input: { sessionId: string; clientMembershipIds: readonly string[]; range: TimeRange },
): Promise<boolean> {
  for (const clientMembershipId of input.clientMembershipIds) {
    const busyElsewhere = await client.booking.findFirst({
      where: {
        clientMembershipId,
        status: 'confirmed',
        classSession: {
          id: { not: input.sessionId },
          status: 'scheduled',
          startsAt: { lt: input.range.endsAt },
          endsAt: { gt: input.range.startsAt },
        },
      },
      select: { id: true },
    });
    if (busyElsewhere !== null) return true;
  }
  return false;
}

function isTimeChanged(
  session: { readonly startsAt: Date; readonly endsAt: Date },
  range: TimeRange,
): boolean {
  return (
    session.startsAt.getTime() !== range.startsAt.getTime() ||
    session.endsAt.getTime() !== range.endsAt.getTime()
  );
}

/**
 * Cambia de fecha u hora una sola sesión de una serie: las plazas se van con ella y cada persona
 * (y quien la da) recibe el aviso. El resto de la serie no se toca.
 */
export async function moveSessionInTransaction(
  client: TenantTransactionClient,
  actor: ActorContext,
  move: SessionMove,
): Promise<MoveSessionOutcome> {
  const session = await client.classSession.findFirst({
    where: { id: move.sessionId },
    include: MOVABLE_SESSION_INCLUDE,
  });
  if (!session) return { kind: 'not_found' };
  const { timeZone } = await loadCenterCalendar(client);
  const range: TimeRange = {
    startsAt: zonedDateTimeToUtc(move.date, move.startsAtTime, timeZone),
    endsAt: zonedDateTimeToUtc(move.date, move.endsAtTime, timeZone),
  };
  const isMovable =
    session.status === 'scheduled' && session.startsAt > move.now && range.startsAt > move.now;
  if (!isMovable) return { kind: 'not_movable' };
  const conflict = await findPlaceConflict(client, session, range);
  if (conflict !== null) return { kind: conflict };
  const clientMembershipIds = session.bookings.map(({ clientMembershipId }) => clientMembershipId);
  if (await isAnyAttendeeBusy(client, { sessionId: session.id, clientMembershipIds, range })) {
    return { kind: 'client_busy' };
  }
  const locationData = move.location === undefined ? {} : toLocationColumns(move.location);
  await client.classSession.update({
    where: { id: session.id },
    data: { ...range, ...locationData },
  });
  const notifiedPersonCount = await recordSessionMovedNotices(client, actor, {
    session: { ...session, startsAt: range.startsAt },
    clientMembershipIds,
    isTimeChanged: isTimeChanged(session, range),
    newPlaceName: move.location?.name ?? null,
  });
  return { kind: 'moved', notifiedPersonCount };
}
