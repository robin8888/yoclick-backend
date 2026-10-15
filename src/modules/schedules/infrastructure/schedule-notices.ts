import { v7 as generateUuidV7 } from 'uuid';
import { type TenantTransactionClient } from '../../../shared/database/tenant-prisma.service';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import {
  type EnrollmentNotificationData,
  type SessionCancelledNotificationData,
} from '../../notifications/domain/notification-rules';

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

export interface CancelledSessionNotice {
  readonly session: {
    readonly id: string;
    readonly startsAt: Date;
    readonly staffMembershipId: string | null;
    readonly service: { readonly name: string };
    readonly room: { readonly name: string } | null;
  };
  readonly reason: string;
  readonly recipientMembershipIds: readonly string[];
}

/** Avisa a cada persona que tenía plaza (y a quien daba la clase) de que ese día se ha cancelado. */
export async function recordSessionCancelledNotices(
  client: TenantTransactionClient,
  actor: ActorContext,
  notice: CancelledSessionNotice,
): Promise<void> {
  const recipients = new Set(notice.recipientMembershipIds);
  if (notice.session.staffMembershipId !== null) recipients.add(notice.session.staffMembershipId);
  recipients.delete(actor.membershipId);
  if (recipients.size === 0) return;
  const noticeData: SessionCancelledNotificationData = {
    serviceName: notice.session.service.name,
    startsAt: notice.session.startsAt.toISOString(),
    roomName: notice.session.room?.name ?? '',
    reason: notice.reason,
    actorName: await findFullName(client, actor.membershipId),
  };
  await client.notification.createMany({
    data: [...recipients].map((recipientMembershipId) => ({
      id: generateUuidV7(),
      centerId: actor.centerId,
      recipientMembershipId,
      kind: 'session_cancelled',
      data: noticeData,
    })),
  });
}

export interface EnrollmentNotice {
  readonly kind: 'schedule_enrolled' | 'schedule_unenrolled';
  readonly clientMembershipIds: readonly string[];
  readonly series: {
    readonly label: string | null;
    readonly service: { readonly name: string };
    readonly staff: { readonly fullName: string } | null;
    readonly room: { readonly name: string } | null;
  };
}

/** Avisa a cada persona de que entra en (o sale de) un grupo fijo. */
export async function recordEnrollmentNotices(
  client: TenantTransactionClient,
  actor: ActorContext,
  notice: EnrollmentNotice,
): Promise<void> {
  const recipients = notice.clientMembershipIds.filter((id) => id !== actor.membershipId);
  if (recipients.length === 0) return;
  const noticeData: EnrollmentNotificationData = {
    serviceName: notice.series.service.name,
    label: notice.series.label ?? '',
    staffName: notice.series.staff?.fullName ?? '',
    roomName: notice.series.room?.name ?? '',
    actorName: await findFullName(client, actor.membershipId),
  };
  await client.notification.createMany({
    data: recipients.map((recipientMembershipId) => ({
      id: generateUuidV7(),
      centerId: actor.centerId,
      recipientMembershipId,
      kind: notice.kind,
      data: noticeData,
    })),
  });
}
