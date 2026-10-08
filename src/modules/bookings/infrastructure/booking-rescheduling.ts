import { type TenantTransactionClient } from '../../../shared/database/tenant-prisma.service';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { recordBookingNotification } from '../../notifications/infrastructure/booking-notification.recorder';
import {
  isCancellationWithinPolicy,
  resolveCancellationNoticeMinutes,
} from '../domain/cancellation-policy';
import {
  type RescheduleBookingCommand,
  type RescheduleOutcome,
} from '../application/ports/booking.repository';
import { reserveSessionInTransaction } from './booking-creation';
import { toBookingView, WITH_SESSION_DETAILS } from './booking-view.mapper';

interface StoredCancelPolicy {
  readonly freeCancellationHours: number;
}

async function loadReschedulableBooking(
  client: TenantTransactionClient,
  actor: ActorContext,
  bookingId: string,
) {
  // Por id Y por dueño: la reserva de otra persona es indistinguible de una inexistente (BOLA).
  return client.booking.findFirst({
    where: { id: bookingId, clientMembershipId: actor.membershipId },
    include: WITH_SESSION_DETAILS,
  });
}

async function hasEnoughNotice(
  client: TenantTransactionClient,
  input: {
    startsAt: Date;
    now: Date;
    serviceCancelNoticeMinutes: number | null;
  },
): Promise<boolean> {
  const center = await client.center.findFirstOrThrow({ select: { cancelPolicy: true } });
  // Escrito por esta API tras validarlo con zod (ajustes del centro).
  const policy = center.cancelPolicy as StoredCancelPolicy | null;
  const noticeMinutes = resolveCancellationNoticeMinutes({
    serviceCancelNoticeMinutes: input.serviceCancelNoticeMinutes,
    centerFreeCancellationHours: policy?.freeCancellationHours ?? null,
  });
  return isCancellationWithinPolicy({ startsAt: input.startsAt, now: input.now, noticeMinutes });
}

type LoadedBooking = NonNullable<Awaited<ReturnType<typeof loadReschedulableBooking>>>;

function canBeRescheduled(booking: LoadedBooking, now: Date): boolean {
  return (
    booking.status === 'confirmed' &&
    booking.startedAt === null &&
    booking.classSession.startsAt > now
  );
}

/**
 * Libera la sesión antigua antes de buscar para poder moverla a una hora que se solape con ella;
 * si el hueco nuevo no existe, la deja como estaba (misma transacción).
 */
async function reserveReplacementSession(
  client: TenantTransactionClient,
  actor: ActorContext,
  input: { booking: LoadedBooking; command: RescheduleBookingCommand },
) {
  const { classSession: previousSession } = input.booking;
  await client.classSession.update({
    where: { id: previousSession.id },
    data: { status: 'cancelled' },
  });
  const reservation = await reserveSessionInTransaction(client, actor, {
    serviceId: previousSession.service.id,
    startsAt: input.command.startsAt,
    preferredStaffMembershipId: previousSession.staffMembership.id,
    idempotencyKey: null,
    now: input.command.now,
  });
  if (reservation.kind !== 'reserved') {
    await client.classSession.update({
      where: { id: previousSession.id },
      data: { status: 'scheduled' },
    });
  }
  return reservation;
}

/**
 * Cambia de hora una reserva del propio cliente con el mismo servicio, y la misma persona si sigue
 * libre. La reserva es la misma (no queda una cancelada en el historial): solo cambia de sesión.
 */
export async function rescheduleBookingInTransaction(
  client: TenantTransactionClient,
  actor: ActorContext,
  command: RescheduleBookingCommand,
): Promise<RescheduleOutcome> {
  const booking = await loadReschedulableBooking(client, actor, command.bookingId);
  if (!booking) return { kind: 'not_found' };
  if (!canBeRescheduled(booking, command.now)) return { kind: 'not_reschedulable' };
  const { classSession: previousSession } = booking;
  if (previousSession.startsAt.getTime() === command.startsAt.getTime()) {
    return { kind: 'rescheduled', booking: toBookingView(booking), hasChangedTime: false };
  }
  const isWithinNotice = await hasEnoughNotice(client, {
    startsAt: previousSession.startsAt,
    now: command.now,
    serviceCancelNoticeMinutes: previousSession.service.cancelNoticeMinutes,
  });
  if (!isWithinNotice) return { kind: 'too_late' };

  const reservation = await reserveReplacementSession(client, actor, { booking, command });
  if (reservation.kind !== 'reserved') return reservation;
  const moved = await client.booking.update({
    where: { id: booking.id },
    data: { classSessionId: reservation.sessionId },
    include: WITH_SESSION_DETAILS,
  });
  await recordBookingNotification(client, {
    centerId: actor.centerId,
    change: 'rescheduled',
    bookingId: booking.id,
    clientMembershipId: booking.clientMembershipId,
    staffMembershipId: reservation.staffMembershipId,
    serviceName: reservation.service.name,
    startsAt: command.startsAt,
    actorMembershipId: actor.membershipId,
  });
  return { kind: 'rescheduled', booking: toBookingView(moved), hasChangedTime: true };
}
