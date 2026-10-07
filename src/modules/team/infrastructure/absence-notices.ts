import { v7 as generateUuidV7 } from 'uuid';
import { type TenantTransactionClient } from '../../../shared/database/tenant-prisma.service';
import {
  selectNotificationRecipients,
  type AbsenceNotificationData,
  type BookingNotificationData,
} from '../../notifications/domain/notification-rules';
import { type NewAbsence } from '../application/ports/staff-availability.repository';

export interface AffectedBooking {
  readonly id: string;
  readonly clientMembershipId: string;
  readonly classSession: { readonly startsAt: Date; readonly service: { readonly name: string } };
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

function buildClientNotice(centerId: string, booking: AffectedBooking, staffName: string) {
  const bookingData: Partial<BookingNotificationData> = {
    serviceName: booking.classSession.service.name,
    startsAt: booking.classSession.startsAt.toISOString(),
    staffName,
  };
  return {
    id: generateUuidV7(),
    centerId,
    recipientMembershipId: booking.clientMembershipId,
    kind: 'booking_affected_by_absence' as const,
    data: bookingData,
    bookingId: booking.id,
  };
}

async function buildTeamNotices(
  client: TenantTransactionClient,
  request: {
    centerId: string;
    absence: NewAbsence;
    actorMembershipId: string;
    staffName: string;
    affectedCount: number;
  },
) {
  const { centerId, absence, actorMembershipId } = request;
  const administrators = await client.membership.findMany({
    where: { role: { in: ['owner', 'admin'] }, status: 'active' },
    select: { id: true },
  });
  const recipients = selectNotificationRecipients({
    staffMembershipId: absence.membershipId,
    administratorMembershipIds: administrators.map(({ id }) => id),
    actorMembershipId,
  });
  const absenceData: AbsenceNotificationData = {
    staffName: request.staffName,
    actorName: await findFullName(client, actorMembershipId),
    startsOn: absence.startsOn,
    endsOn: absence.endsOn,
    reason: absence.reason,
    affectedBookingCount: String(request.affectedCount),
  };
  return recipients.map((recipientMembershipId) => ({
    id: generateUuidV7(),
    centerId,
    recipientMembershipId,
    kind: 'absence_added' as const,
    data: absenceData,
  }));
}

/**
 * Deja los avisos de una ausencia: a administración y a la persona ausente (si no la puso ella), y a
 * cada cliente que tenía una cita esos días. Se escriben con la ausencia; el envío al móvil ocurre después.
 */
export async function recordAbsenceNotices(
  client: TenantTransactionClient,
  request: {
    readonly centerId: string;
    readonly absence: NewAbsence;
    readonly actorMembershipId: string;
    readonly affectedBookings: readonly AffectedBooking[];
  },
): Promise<void> {
  const { centerId, absence, actorMembershipId, affectedBookings } = request;
  const staffName = await findFullName(client, absence.membershipId);
  const teamNotices = await buildTeamNotices(client, {
    centerId,
    absence,
    actorMembershipId,
    staffName,
    affectedCount: affectedBookings.length,
  });
  await client.notification.createMany({
    data: [
      ...teamNotices,
      ...affectedBookings.map((booking) => buildClientNotice(centerId, booking, staffName)),
    ],
  });
}
