import { type TenantTransactionClient } from '../../../shared/database/tenant-prisma.service';

/**
 * Tras cancelar una reserva, la sesión solo se libera (hueco de la persona y de la sala) si ya no
 * le queda nadie apuntado. En una cita privada es siempre así; en una grupal, la clase sigue
 * mientras quede alguien.
 */
export async function releaseSessionIfEmpty(
  client: TenantTransactionClient,
  sessionId: string,
): Promise<void> {
  const remainingBookings = await client.booking.count({
    where: { classSessionId: sessionId, status: { not: 'cancelled' } },
  });
  if (remainingBookings > 0) return;
  await client.classSession.update({ where: { id: sessionId }, data: { status: 'cancelled' } });
}
