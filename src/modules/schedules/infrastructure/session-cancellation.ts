import { type TenantTransactionClient } from '../../../shared/database/tenant-prisma.service';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { recordSessionCancelledNotices } from './schedule-notices';

const SESSION_CANCELLATION_INCLUDE = {
  service: { select: { name: true } },
  room: { select: { name: true } },
  bookings: { where: { status: 'confirmed' }, select: { id: true, clientMembershipId: true } },
} as const;

export interface CancellableSession {
  readonly id: string;
  readonly startsAt: Date;
  readonly staffMembershipId: string;
  readonly service: { readonly name: string };
  readonly room: { readonly name: string } | null;
  readonly bookings: readonly { readonly id: string; readonly clientMembershipId: string }[];
}

export async function findCancellableSession(
  client: TenantTransactionClient,
  sessionId: string,
): Promise<CancellableSession | null> {
  return client.classSession.findFirst({
    where: { id: sessionId, status: 'scheduled' },
    include: SESSION_CANCELLATION_INCLUDE,
  });
}

/** Las sesiones programadas de esos horarios que empiezan después de `after`, con sus plazas confirmadas. */
export async function listFutureSessionsOfSchedules(
  client: TenantTransactionClient,
  input: { scheduleIds: readonly string[]; after: Date },
): Promise<(CancellableSession & { readonly singleBookingCount: number })[]> {
  const sessions = await client.classSession.findMany({
    where: {
      scheduleId: { in: [...input.scheduleIds] },
      status: 'scheduled',
      startsAt: { gt: input.after },
    },
    include: {
      ...SESSION_CANCELLATION_INCLUDE,
      _count: { select: { bookings: { where: { status: 'confirmed', source: 'single' } } } },
    },
    orderBy: [{ startsAt: 'asc' }],
  });
  return sessions.map((session) => ({ ...session, singleBookingCount: session._count.bookings }));
}

export interface SessionCancellationRequest {
  readonly session: CancellableSession;
  readonly reason: string;
  readonly now: Date;
  /** Si se avisa a las personas con plaza (al cancelar un día sí; al terminar una serie se avisa aparte). */
  readonly shouldNotify: boolean;
}

/**
 * Cancela una sesión y todas sus plazas de golpe: el centro lo decide, así que nadie pierde crédito
 * (`cancelWithinPolicy = true`). La sesión queda cancelada con su motivo para que se vea en la agenda.
 */
export async function cancelSessionWithBookings(
  client: TenantTransactionClient,
  actor: ActorContext,
  request: SessionCancellationRequest,
): Promise<number> {
  const { session } = request;
  await client.classSession.update({
    where: { id: session.id },
    data: {
      status: 'cancelled',
      cancelledReason: request.reason,
      cancelledByMembershipId: actor.membershipId,
    },
  });
  const bookingIds = session.bookings.map(({ id }) => id);
  if (bookingIds.length > 0) {
    await client.booking.updateMany({
      where: { id: { in: bookingIds }, status: 'confirmed' },
      data: {
        status: 'cancelled',
        cancelledAt: request.now,
        cancelledBy: 'staff',
        cancelWithinPolicy: true,
      },
    });
  }
  if (request.shouldNotify) {
    await recordSessionCancelledNotices(client, actor, {
      session,
      reason: request.reason,
      recipientMembershipIds: session.bookings.map(({ clientMembershipId }) => clientMembershipId),
    });
  }
  return bookingIds.length;
}
