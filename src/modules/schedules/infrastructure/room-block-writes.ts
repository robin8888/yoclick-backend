import { v7 as generateUuidV7 } from 'uuid';
import { type TenantTransactionClient } from '../../../shared/database/tenant-prisma.service';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import {
  type NewRoomBlock,
  type RoomBlockCreationOutcome,
  type RoomBlockView,
} from '../application/ports/schedule.repository';
import { lockRoom } from './room-block-queries';
import { BLOCK_VIEW_INCLUDE, toRoomBlockView } from './schedule-view.mapper';
import { cancelSessionWithBookings } from './session-cancellation';

export async function listBlocksInTransaction(
  client: TenantTransactionClient,
  query: { roomId: string | null; from: Date; to: Date },
): Promise<RoomBlockView[]> {
  const blocks = await client.roomBlock.findMany({
    where: {
      ...(query.roomId !== null && { roomId: query.roomId }),
      startsAt: { lt: query.to },
      endsAt: { gt: query.from },
    },
    include: BLOCK_VIEW_INCLUDE,
    orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
  });
  return blocks.map(toRoomBlockView);
}

/** Lo que ocupa la sala en el tramo del bloqueo, con sus plazas confirmadas (sueltas y de matrícula). */
async function listSessionsInRange(client: TenantTransactionClient, newBlock: NewRoomBlock) {
  return client.classSession.findMany({
    where: {
      roomId: newBlock.roomId,
      status: 'scheduled',
      startsAt: { lt: newBlock.endsAt },
      endsAt: { gt: newBlock.startsAt },
    },
    include: {
      service: { select: { name: true } },
      room: { select: { name: true } },
      bookings: {
        where: { status: 'confirmed' },
        select: { id: true, clientMembershipId: true, source: true },
      },
    },
  });
}

/** Inserta el bloqueo; la restricción EXCLUDE deja fuera uno que se solape con otro de la misma sala. */
async function tryInsertBlock(
  client: TenantTransactionClient,
  actor: ActorContext,
  newBlock: NewRoomBlock,
): Promise<string | null> {
  const blockId = generateUuidV7();
  const inserted = await client.$queryRaw<{ id: string }[]>`
    insert into room_blocks (id, center_id, room_id, starts_at, ends_at, reason, note, created_by_membership_id)
    values (${blockId}::uuid, ${actor.centerId}::uuid, ${newBlock.roomId}::uuid,
            ${newBlock.startsAt}::timestamptz, ${newBlock.endsAt}::timestamptz,
            ${newBlock.reason}::room_block_reason, ${newBlock.note}, ${actor.membershipId}::uuid)
    on conflict do nothing
    returning id`;
  return inserted.length === 1 ? blockId : null;
}

/**
 * Bloquea la sala. Las sesiones de horario sin citas sueltas que caigan dentro se cancelan (con aviso
 * a los matriculados); si alguna tiene citas sueltas, hay que resolverlas antes y no se bloquea nada.
 */
export async function createBlockInTransaction(
  client: TenantTransactionClient,
  actor: ActorContext,
  newBlock: NewRoomBlock,
): Promise<RoomBlockCreationOutcome> {
  const room = await client.room.findFirst({
    where: { id: newBlock.roomId, archivedAt: null },
    select: { id: true },
  });
  if (!room) return { kind: 'room_not_found' };
  await lockRoom(client, newBlock.roomId);

  const sessions = await listSessionsInRange(client, newBlock);
  const withSingleBookings = sessions.filter((session) =>
    session.bookings.some((booking) => booking.source === 'single'),
  );
  if (withSingleBookings.length > 0) {
    return { kind: 'has_bookings', sessionCount: withSingleBookings.length };
  }
  for (const session of sessions) {
    await cancelSessionWithBookings(client, actor, {
      session,
      reason: 'blocked',
      now: newBlock.startsAt < new Date() ? newBlock.startsAt : new Date(),
      shouldNotify: true,
    });
  }
  const blockId = await tryInsertBlock(client, actor, newBlock);
  if (blockId === null) return { kind: 'overlaps_block' };
  const block = await client.roomBlock.findUniqueOrThrow({
    where: { id: blockId },
    include: BLOCK_VIEW_INCLUDE,
  });
  return { kind: 'created', block: toRoomBlockView(block), cancelledSessionCount: sessions.length };
}

export async function deleteBlockInTransaction(
  client: TenantTransactionClient,
  request: { roomId: string; blockId: string },
): Promise<boolean> {
  const deleted = await client.roomBlock.deleteMany({
    where: { id: request.blockId, roomId: request.roomId },
  });
  return deleted.count === 1;
}
