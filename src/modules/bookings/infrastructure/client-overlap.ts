import { type TenantTransactionClient } from '../../../shared/database/tenant-prisma.service';

/** Si la persona ya tiene una cita confirmada que se solapa con ese tramo (una persona, una cita a la vez). */
export async function hasOverlappingBooking(
  client: TenantTransactionClient,
  input: { clientMembershipId: string; startsAt: Date; endsAt: Date },
): Promise<boolean> {
  const overlappingBooking = await client.booking.findFirst({
    where: {
      clientMembershipId: input.clientMembershipId,
      status: 'confirmed',
      classSession: {
        status: 'scheduled',
        startsAt: { lt: input.endsAt },
        endsAt: { gt: input.startsAt },
      },
    },
    select: { id: true },
  });
  return overlappingBooking !== null;
}
