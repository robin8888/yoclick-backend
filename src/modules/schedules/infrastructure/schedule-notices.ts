import { v7 as generateUuidV7 } from 'uuid';
import { type TenantTransactionClient } from '../../../shared/database/tenant-prisma.service';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import {
  type BookingNotificationData,
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
  readonly kind: 'schedule_enrolled' | 'schedule_unenrolled' | 'schedule_updated';
  readonly clientMembershipIds: readonly string[];
  /** El sitio nuevo si lo único que cambia es el lugar de la clase. */
  readonly placeName?: string | undefined;
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
    ...(notice.placeName === undefined ? {} : { placeName: notice.placeName }),
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

export interface MovedSessionNotice {
  /** La hora cambia (si solo cambia el lugar, el aviso dice el sitio nuevo). */
  readonly isTimeChanged: boolean;
  readonly newPlaceName: string | null;
  readonly session: {
    readonly startsAt: Date;
    readonly staffMembershipId: string | null;
    readonly service: { readonly name: string };
    readonly staffMembership: { readonly user: { readonly fullName: string } } | null;
  };
  readonly clientMembershipIds: readonly string[];
}

/**
 * Avisa a cada persona con plaza (y a quien da la clase) de que ese día cambia de hora, con el
 * mismo aviso que un cambio de hora hecho por el centro. Devuelve a cuántas personas avisó.
 */
export async function recordSessionMovedNotices(
  client: TenantTransactionClient,
  actor: ActorContext,
  notice: MovedSessionNotice,
): Promise<number> {
  const recipients = new Set(notice.clientMembershipIds);
  if (notice.session.staffMembershipId !== null) recipients.add(notice.session.staffMembershipId);
  recipients.delete(actor.membershipId);
  if (recipients.size === 0) return 0;
  if (!notice.isTimeChanged && notice.newPlaceName !== null) {
    return recordPlaceChangedNotices(client, actor, {
      recipients: [...recipients],
      session: notice.session,
      placeName: notice.newPlaceName,
    });
  }
  const noticeData: BookingNotificationData = {
    clientName: '',
    serviceName: notice.session.service.name,
    startsAt: notice.session.startsAt.toISOString(),
    staffName: notice.session.staffMembership?.user.fullName ?? '',
    actorName: await findFullName(client, actor.membershipId),
  };
  await client.notification.createMany({
    data: [...recipients].map((recipientMembershipId) => ({
      id: generateUuidV7(),
      centerId: actor.centerId,
      recipientMembershipId,
      kind: 'booking_rescheduled_by_team' as const,
      data: noticeData,
    })),
  });
  return recipients.size;
}

interface PlaceChangedNotices {
  readonly recipients: readonly string[];
  readonly session: MovedSessionNotice['session'];
  readonly placeName: string;
}

/** «Ahora es en el Auditorio Municipal»: el aviso de un día cuya hora no cambia pero sí el lugar. */
async function recordPlaceChangedNotices(
  client: TenantTransactionClient,
  actor: ActorContext,
  input: PlaceChangedNotices,
): Promise<number> {
  const noticeData: EnrollmentNotificationData = {
    placeName: input.placeName,
    serviceName: input.session.service.name,
    label: input.session.service.name,
    staffName: '',
    roomName: '',
    actorName: await findFullName(client, actor.membershipId),
  };
  await client.notification.createMany({
    data: input.recipients.map((recipientMembershipId) => ({
      id: generateUuidV7(),
      centerId: actor.centerId,
      recipientMembershipId,
      kind: 'schedule_updated' as const,
      data: noticeData,
    })),
  });
  return input.recipients.length;
}
