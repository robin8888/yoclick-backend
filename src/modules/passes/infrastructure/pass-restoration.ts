import { v7 as generateUuidV7 } from 'uuid';
import { type TenantTransactionClient } from '../../../shared/database/tenant-prisma.service';

/**
 * Devuelve al bono la clase que se descontó por una reserva que ya no se va a dar (la cita se
 * cancela). Solo existe un descuento por reserva y solo se devuelve una vez; si la reserva nunca
 * descontó (aún no había asistido), no hace nada.
 */
export async function restorePassForBooking(
  client: TenantTransactionClient,
  input: { bookingId: string },
): Promise<void> {
  const consumed = await client.balanceMovement.findUnique({
    where: { bookingId: input.bookingId },
    select: { id: true, centerId: true, clientPassId: true, clientMembershipId: true },
  });
  if (!consumed) return;
  const alreadyRestored = await client.balanceMovement.findUnique({
    where: { restoresMovementId: consumed.id },
    select: { id: true },
  });
  if (alreadyRestored) return;

  // «Sin pasarse del total»: el CHECK de la tabla lo exige y aquí se condiciona la suma.
  const restored = await client.$executeRaw`
    update client_passes
       set remaining_sessions = remaining_sessions + 1
     where id = ${consumed.clientPassId}::uuid and remaining_sessions < total_sessions`;
  if (restored === 0) return;
  await client.balanceMovement.create({
    data: {
      id: generateUuidV7(),
      centerId: consumed.centerId,
      clientPassId: consumed.clientPassId,
      clientMembershipId: consumed.clientMembershipId,
      bookingId: null,
      restoresMovementId: consumed.id,
      delta: 1,
      reason: 'restored',
    },
  });
}
