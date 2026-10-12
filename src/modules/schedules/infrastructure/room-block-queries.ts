import { type TenantTransactionClient } from '../../../shared/database/tenant-prisma.service';

/** Si la sala está bloqueada (alquiler, mantenimiento, evento) en algún momento de ese tramo. */
export async function isRoomBlocked(
  client: TenantTransactionClient,
  input: { roomId: string; startsAt: Date; endsAt: Date },
): Promise<boolean> {
  const block = await client.roomBlock.findFirst({
    where: {
      roomId: input.roomId,
      startsAt: { lt: input.endsAt },
      endsAt: { gt: input.startsAt },
    },
    select: { id: true },
  });
  return block !== null;
}

/** Serializa los cambios sobre una sala (bloquearla, crear sesiones en ella) dentro de la transacción. */
export async function lockRoom(client: TenantTransactionClient, roomId: string): Promise<void> {
  await client.$executeRaw`select pg_advisory_xact_lock(hashtextextended(${roomId}, 3))`;
}
