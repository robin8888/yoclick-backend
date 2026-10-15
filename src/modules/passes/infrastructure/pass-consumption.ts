import { v7 as generateUuidV7 } from 'uuid';
import { type TenantTransactionClient } from '../../../shared/database/tenant-prisma.service';
import { pickPassToConsume } from '../domain/pass-rules';

/** Con tantas sesiones o menos se avisa a la persona de que su bono se acaba. */
const LOW_PASS_SESSION_COUNT = 1;

interface ConsumableBooking {
  readonly centerId: string;
  readonly clientMembershipId: string;
  readonly serviceId: string;
  /** Cuándo empezaba la clase: el bono tiene que seguir en vigor entonces. */
  readonly classStartsAt: Date;
}

/** La reserva que va a gastar bono: null si no existe, es de matrícula o ya descontó. */
async function findBookingToConsume(
  client: TenantTransactionClient,
  bookingId: string,
): Promise<ConsumableBooking | null> {
  const booking = await client.booking.findUnique({
    where: { id: bookingId },
    select: {
      centerId: true,
      clientMembershipId: true,
      source: true,
      classSession: { select: { serviceId: true, startsAt: true } },
      passMovement: { select: { id: true } },
    },
  });
  // La matrícula en un grupo fijo no gasta bono: ya está cubierta.
  if (!booking || booking.source === 'enrollment' || booking.passMovement) return null;
  return {
    centerId: booking.centerId,
    clientMembershipId: booking.clientMembershipId,
    serviceId: booking.classSession.serviceId,
    classStartsAt: booking.classSession.startsAt,
  };
}

/**
 * Descuenta una clase del bono de la persona cuando asiste (al registrar su llegada o al cerrar la
 * clase, lo que ocurra primero). Es idempotente: el libro tiene una sola fila por reserva, así que
 * el segundo aviso no descuenta otra vez. Sin bono que valga no hace nada: la clase es suelta.
 */
export async function consumePassForBooking(
  client: TenantTransactionClient,
  input: { bookingId: string; now: Date },
): Promise<void> {
  const booking = await findBookingToConsume(client, input.bookingId);
  if (!booking) return;
  const candidates = await client.clientPass.findMany({
    where: {
      clientMembershipId: booking.clientMembershipId,
      status: 'active',
      remainingSessions: { gt: 0 },
    },
    select: { id: true, status: true, remainingSessions: true, expiresAt: true, serviceIds: true },
  });
  // Vale el bono que estaba en vigor cuando empezaba la clase (o ahora, si es una clase futura).
  const referenceTime = booking.classStartsAt < input.now ? booking.classStartsAt : input.now;
  const passId = pickPassToConsume(candidates, {
    serviceId: booking.serviceId,
    now: referenceTime,
  });
  if (passId === null) return;

  // Condicionado a «aún quedan»: dos clases a la vez nunca dejan el bono por debajo de cero.
  const decremented = await client.clientPass.updateMany({
    where: { id: passId, remainingSessions: { gt: 0 } },
    data: { remainingSessions: { decrement: 1 } },
  });
  if (decremented.count === 0) return;
  await client.balanceMovement.create({
    data: {
      id: generateUuidV7(),
      centerId: booking.centerId,
      clientPassId: passId,
      clientMembershipId: booking.clientMembershipId,
      bookingId: input.bookingId,
      delta: -1,
      reason: 'consumed',
    },
  });
  await notifyIfPassIsRunningLow(client, { passId, centerId: booking.centerId });
}

/** Avisa al cliente cuando le queda la última sesión y cuando ya no le queda ninguna. */
async function notifyIfPassIsRunningLow(
  client: TenantTransactionClient,
  input: { passId: string; centerId: string },
): Promise<void> {
  const pass = await client.clientPass.findUniqueOrThrow({
    where: { id: input.passId },
    select: { name: true, remainingSessions: true, clientMembershipId: true },
  });
  if (pass.remainingSessions > LOW_PASS_SESSION_COUNT) return;
  await client.notification.create({
    data: {
      id: generateUuidV7(),
      centerId: input.centerId,
      recipientMembershipId: pass.clientMembershipId,
      kind: pass.remainingSessions === 0 ? 'pass_exhausted' : 'pass_running_low',
      data: { rateName: pass.name },
    },
  });
}
