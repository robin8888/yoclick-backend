import { requireTeacher } from './require-teacher';
import { MILLISECONDS_PER_DAY, MILLISECONDS_PER_MINUTE } from '../../../shared/time/time-units';
import { type TenantTransactionClient } from '../../../shared/database/tenant-prisma.service';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { recordBookingNotification } from '../../notifications/infrastructure/booking-notification.recorder';
import {
  isCancellationWithinPolicy,
  resolveCancellationNoticeMinutes,
} from '../domain/cancellation-policy';
import {
  type MoveToSessionCommand,
  type RescheduleOutcome,
} from '../application/ports/booking.repository';
import { releaseSessionIfEmpty } from './session-release';
import { toBookingView, WITH_SESSION_DETAILS } from './booking-view.mapper';

interface StoredCancelPolicy {
  readonly freeCancellationHours: number;
}

/** Por id Y por dueño: la reserva de otra persona es indistinguible de una inexistente (BOLA). */
async function loadOwnBooking(
  client: TenantTransactionClient,
  actor: ActorContext,
  bookingId: string,
) {
  return client.booking.findFirst({
    where: { id: bookingId, clientMembershipId: actor.membershipId },
    include: WITH_SESSION_DETAILS,
  });
}

type OwnBooking = NonNullable<Awaited<ReturnType<typeof loadOwnBooking>>>;

/** Se puede pasar a otra clase mientras siga confirmada, sin empezar y por delante. */
function canBeMoved(booking: OwnBooking, now: Date): boolean {
  return (
    booking.status === 'confirmed' &&
    booking.startedAt === null &&
    booking.classSession.startsAt > now
  );
}

/** Pide la misma antelación que cancelar: el centro cuenta con esa plaza. */
async function hasEnoughNotice(
  client: TenantTransactionClient,
  booking: OwnBooking,
  now: Date,
): Promise<boolean> {
  const center = await client.center.findFirstOrThrow({ select: { cancelPolicy: true } });
  // Escrito por esta API tras validarlo con zod (ajustes del centro).
  const policy = center.cancelPolicy as StoredCancelPolicy | null;
  const noticeMinutes = resolveCancellationNoticeMinutes({
    serviceCancelNoticeMinutes: booking.classSession.service.cancelNoticeMinutes,
    centerFreeCancellationHours: policy?.freeCancellationHours ?? null,
  });
  return isCancellationWithinPolicy({
    startsAt: booking.classSession.startsAt,
    now,
    noticeMinutes,
  });
}

/** La clase de destino: del mismo servicio, por delante y dentro de la antelación y la ventana. */
async function findTargetSession(
  client: TenantTransactionClient,
  input: { booking: OwnBooking; command: MoveToSessionCommand },
) {
  const { booking, command } = input;
  const session = await client.classSession.findFirst({
    where: {
      id: command.classSessionId,
      serviceId: booking.classSession.service.id,
      status: 'scheduled',
      startsAt: { gt: command.now },
    },
    include: {
      service: { select: { name: true, minNoticeMinutes: true, bookingWindowDays: true } },
    },
  });
  if (!session) return null;
  const earliest =
    command.now.getTime() + session.service.minNoticeMinutes * MILLISECONDS_PER_MINUTE;
  const latest = command.now.getTime() + session.service.bookingWindowDays * MILLISECONDS_PER_DAY;
  const startsAt = session.startsAt.getTime();
  return startsAt >= earliest && startsAt <= latest ? session : null;
}

async function hasOtherBookingAtThatTime(
  client: TenantTransactionClient,
  input: { booking: OwnBooking; session: { startsAt: Date; endsAt: Date } },
): Promise<boolean> {
  const other = await client.booking.findFirst({
    where: {
      id: { not: input.booking.id },
      clientMembershipId: input.booking.clientMembershipId,
      status: 'confirmed',
      classSession: {
        status: 'scheduled',
        startsAt: { lt: input.session.endsAt },
        endsAt: { gt: input.session.startsAt },
      },
    },
    select: { id: true },
  });
  return other !== null;
}

/**
 * El cliente cambia su reserva a otra clase con plazas del mismo servicio: la plaza de la clase
 * antigua queda libre (vuelve al aforo de su sala), ocupa una de la nueva, y se avisa al
 * profesor y al centro. Pide la misma antelación que cancelar.
 */
export async function moveBookingToSessionInTransaction(
  client: TenantTransactionClient,
  actor: ActorContext,
  command: MoveToSessionCommand,
): Promise<RescheduleOutcome> {
  const booking = await loadOwnBooking(client, actor, command.bookingId);
  if (!booking) return { kind: 'not_found' };
  if (!canBeMoved(booking, command.now)) return { kind: 'not_reschedulable' };
  if (booking.classSession.id === command.classSessionId) {
    return { kind: 'rescheduled', booking: toBookingView(booking), hasChangedTime: false };
  }
  if (!(await hasEnoughNotice(client, booking, command.now))) return { kind: 'too_late' };

  const session = await findTargetSession(client, { booking, command });
  if (!session) return { kind: 'slot_unavailable' };
  const seatsTaken = await client.booking.count({
    where: { classSessionId: session.id, status: { not: 'cancelled' } },
  });
  if (seatsTaken >= session.capacity) return { kind: 'session_full' };
  if (await hasOtherBookingAtThatTime(client, { booking, session })) {
    return { kind: 'already_booked' };
  }

  const previousSessionId = booking.classSession.id;
  const moved = await client.booking.update({
    where: { id: booking.id },
    data: { classSessionId: session.id },
    include: WITH_SESSION_DETAILS,
  });
  await releaseSessionIfEmpty(client, previousSessionId);
  await recordBookingNotification(client, {
    centerId: actor.centerId,
    change: 'rescheduled',
    bookingId: booking.id,
    clientMembershipId: booking.clientMembershipId,
    staffMembershipId: requireTeacher(session.staffMembershipId),
    serviceName: session.service.name,
    startsAt: session.startsAt,
    actorMembershipId: actor.membershipId,
  });
  return { kind: 'rescheduled', booking: toBookingView(moved), hasChangedTime: true };
}
