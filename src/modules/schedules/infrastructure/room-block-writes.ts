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

/** Las clases programadas que ocupan la sala en el tramo del bloqueo. */
async function listSessionsInRange(client: TenantTransactionClient, newBlock: NewRoomBlock) {
  return client.classSession.findMany({
    where: {
      roomId: newBlock.roomId,
      status: 'scheduled',
      startsAt: { lt: newBlock.endsAt },
      endsAt: { gt: newBlock.startsAt },
    },
    select: { id: true },
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
 * Bloquea la sala en un tramo futuro y libre: si empieza en el pasado o hay una clase asignada
 * dentro, no se bloquea nada (la clase se cancela o se mueve antes, no la cancela el bloqueo).
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
  if (newBlock.startsAt < new Date()) return { kind: 'in_the_past' };
  await lockRoom(client, newBlock.roomId);

  // Una sala solo se separa en un tramo libre: una clase ya asignada hay que cancelarla o moverla antes.
  const sessions = await listSessionsInRange(client, newBlock);
  if (sessions.length > 0) return { kind: 'has_bookings', sessionCount: sessions.length };
  const blockId = await tryInsertBlock(client, actor, newBlock);
  if (blockId === null) return { kind: 'overlaps_block' };
  const block = await client.roomBlock.findUniqueOrThrow({
    where: { id: blockId },
    include: BLOCK_VIEW_INCLUDE,
  });
  return { kind: 'created', block: toRoomBlockView(block), cancelledSessionCount: 0 };
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
