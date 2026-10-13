import { type TenantTransactionClient } from '../../../shared/database/tenant-prisma.service';
import { consumePassForBooking } from './pass-consumption';

/** Las que se resuelven de una vez: con esto basta, el resto se resuelve en la siguiente consulta. */
const SETTLEMENT_BATCH_SIZE = 200;

/**
 * Las clases que terminaron sin que la persona viniera ni cancelara cuentan como gastadas: la
 * reserva pasa a «no se presentó» y se descuenta del bono. Se hace al consultar los bonos (sin
 * procesos en segundo plano) y es idempotente: el libro tiene una sola fila por reserva. Las
 * canceladas nunca descuentan, y confirmar la asistencia más tarde no vuelve a descontar.
 */
export async function settleEndedBookings(
  client: TenantTransactionClient,
  input: { now: Date; clientMembershipId: string | null },
): Promise<void> {
  const ended = await client.booking.findMany({
    where: {
      status: 'confirmed',
      checkedInAt: null,
      startedAt: null,
      classSession: { status: 'scheduled', endsAt: { lte: input.now } },
      ...(input.clientMembershipId !== null && { clientMembershipId: input.clientMembershipId }),
    },
    select: { id: true },
    take: SETTLEMENT_BATCH_SIZE,
  });
  for (const { id } of ended) {
    // Condicionado a «sigue confirmada»: si alguien la confirmó o canceló entre medias, no se toca.
    const marked = await client.booking.updateMany({
      where: { id, status: 'confirmed', checkedInAt: null },
      data: { status: 'no_show' },
    });
    if (marked.count === 1) await consumePassForBooking(client, { bookingId: id, now: input.now });
  }
}
