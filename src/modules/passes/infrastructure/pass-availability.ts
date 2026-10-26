import { type TenantTransactionClient } from '../../../shared/database/tenant-prisma.service';
import { settleEndedBookings } from './no-show-settlement';

/**
 * Cuántas clases más puede agendar la persona con su bono para ese servicio: lo que le queda
 * menos lo que ya tiene agendado y sin gastar (las clases por venir). Así no se pueden agendar más
 * clases de las que marca el bono aunque aún no se hayan descontado. `null` si no tiene ningún bono
 * en vigor para ese servicio: entonces la clase es suelta y no hay tope.
 */
export async function countBookableClasses(
  client: TenantTransactionClient,
  input: { clientMembershipId: string; serviceId: string; now: Date },
): Promise<number | null> {
  // Las clases ya pasadas sin venir ni cancelar se descuentan antes de contar lo que queda.
  await settleEndedBookings(client, {
    now: input.now,
    clientMembershipId: input.clientMembershipId,
  });
  const passes = await client.clientPass.findMany({
    where: {
      clientMembershipId: input.clientMembershipId,
      status: 'active',
      remainingSessions: { gt: 0 },
    },
    select: { remainingSessions: true, expiresAt: true, serviceIds: true },
  });
  const usable = passes.filter(
    (pass) =>
      (pass.expiresAt === null || pass.expiresAt > input.now) &&
      (pass.serviceIds.length === 0 || pass.serviceIds.includes(input.serviceId)),
  );
  if (usable.length === 0) return null;

  const remaining = usable.reduce((total, pass) => total + pass.remainingSessions, 0);
  const hasPassForEveryService = usable.some((pass) => pass.serviceIds.length === 0);
  const coveredServiceIds = [...new Set(usable.flatMap((pass) => pass.serviceIds))];
  const reserved = await client.booking.count({
    where: {
      clientMembershipId: input.clientMembershipId,
      status: 'confirmed',
      source: 'single',
      // Las que el centro apuntó ya se descontaron: no se cuentan dos veces.
      passMovement: null,
      classSession: {
        status: 'scheduled',
        endsAt: { gt: input.now },
        ...(!hasPassForEveryService && { serviceId: { in: coveredServiceIds } }),
      },
    },
  });
  return Math.max(remaining - reserved, 0);
}

/** Si el centro vende algún bono que valga para ese servicio: entonces reservarlo exige tener uno. */
async function isPassRequiredFor(
  client: TenantTransactionClient,
  serviceId: string,
): Promise<boolean> {
  const rates = await client.rate.findMany({
    where: { archivedAt: null },
    select: { serviceIds: true },
  });
  return rates.some((rate) => rate.serviceIds.length === 0 || rate.serviceIds.includes(serviceId));
}

export type OwnPassCheck = 'ok' | 'pass_required' | 'pass_fully_booked';

/**
 * Lo que dice el bono cuando la propia persona reserva:
 * - con bono en vigor para el servicio: solo tantas clases como le queden menos las ya agendadas;
 * - sin bono: si el centro vende alguno para ese servicio, primero tiene que adquirirlo; si no
 *   vende ninguno, la reserva es libre.
 */
export async function checkOwnPass(
  client: TenantTransactionClient,
  input: { clientMembershipId: string; serviceId: string; now: Date },
): Promise<OwnPassCheck> {
  const bookable = await countBookableClasses(client, input);
  if (bookable === null)
    return (await isPassRequiredFor(client, input.serviceId)) ? 'pass_required' : 'ok';
  return bookable <= 0 ? 'pass_fully_booked' : 'ok';
}
