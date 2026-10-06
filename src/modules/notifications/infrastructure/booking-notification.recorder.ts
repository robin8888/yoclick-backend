import { v7 as generateUuidV7 } from 'uuid';
import { type TenantTransactionClient } from '../../../shared/database/tenant-prisma.service';
import {
  selectNotificationRecipients,
  type BookingNotificationData,
  type NotificationKindName,
} from '../domain/notification-rules';

export interface BookingNotificationInput {
  readonly centerId: string;
  readonly kind: Extract<NotificationKindName, 'booking_created' | 'booking_cancelled'>;
  readonly bookingId: string;
  readonly clientMembershipId: string;
  readonly staffMembershipId: string;
  readonly serviceName: string;
  readonly startsAt: Date;
  /** Quien hizo la acción: no recibe el aviso. */
  readonly actorMembershipId: string;
}

async function findFullName(
  client: TenantTransactionClient,
  membershipId: string,
): Promise<string> {
  const membership = await client.membership.findUnique({
    where: { id: membershipId },
    select: { user: { select: { fullName: true } } },
  });
  return membership?.user.fullName ?? '';
}

/**
 * Deja un aviso a quien da la cita y a quienes administran el centro. Se escribe en la misma
 * transacción que la reserva o la cancelación: o ocurren las dos cosas o ninguna.
 */
export async function recordBookingNotification(
  client: TenantTransactionClient,
  input: BookingNotificationInput,
): Promise<void> {
  const administrators = await client.membership.findMany({
    where: { role: { in: ['owner', 'admin'] }, status: 'active' },
    select: { id: true },
  });
  const recipients = selectNotificationRecipients({
    staffMembershipId: input.staffMembershipId,
    administratorMembershipIds: administrators.map(({ id }) => id),
    actorMembershipId: input.actorMembershipId,
  });
  if (recipients.length === 0) return;

  const noticeData: BookingNotificationData = {
    clientName: await findFullName(client, input.clientMembershipId),
    serviceName: input.serviceName,
    startsAt: input.startsAt.toISOString(),
    staffName: await findFullName(client, input.staffMembershipId),
  };
  await client.notification.createMany({
    data: recipients.map((recipientMembershipId) => ({
      id: generateUuidV7(),
      centerId: input.centerId,
      recipientMembershipId,
      kind: input.kind,
      data: noticeData,
      bookingId: input.bookingId,
    })),
  });
}
