import { v7 as generateUuidV7 } from 'uuid';
import { type TenantTransactionClient } from '../../../shared/database/tenant-prisma.service';
import {
  planBookingNotices,
  type BookingChange,
  type BookingNotificationData,
} from '../domain/notification-rules';

export interface BookingNotificationInput {
  readonly centerId: string;
  readonly change: BookingChange;
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
 * Deja los avisos de un cambio en una cita: al equipo y, si lo hizo el equipo, también al cliente.
 * Se escribe en la misma transacción que la reserva o la cancelación: o ocurren las dos cosas o
 * ninguna. El envío al móvil ocurre después, con `PushDispatcher`.
 */
export async function recordBookingNotification(
  client: TenantTransactionClient,
  input: BookingNotificationInput,
): Promise<void> {
  const administrators = await client.membership.findMany({
    where: { role: { in: ['owner', 'admin'] }, status: 'active' },
    select: { id: true },
  });
  const notices = planBookingNotices({
    change: input.change,
    clientMembershipId: input.clientMembershipId,
    staffMembershipId: input.staffMembershipId,
    administratorMembershipIds: administrators.map(({ id }) => id),
    actorMembershipId: input.actorMembershipId,
  });
  if (notices.length === 0) return;

  const noticeData: BookingNotificationData = {
    clientName: await findFullName(client, input.clientMembershipId),
    serviceName: input.serviceName,
    startsAt: input.startsAt.toISOString(),
    staffName: await findFullName(client, input.staffMembershipId),
    actorName: await findFullName(client, input.actorMembershipId),
  };
  await client.notification.createMany({
    data: notices.map(({ recipientMembershipId, kind }) => ({
      id: generateUuidV7(),
      centerId: input.centerId,
      recipientMembershipId,
      kind,
      data: noticeData,
      bookingId: input.bookingId,
    })),
  });
}
