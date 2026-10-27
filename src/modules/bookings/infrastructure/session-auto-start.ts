import { type TenantTransactionClient } from '../../../shared/database/tenant-prisma.service';
import { findBookingsBlockedByRefund } from '../../passes/infrastructure/refund-block';
import { type BookingWithSessionDetails, WITH_SESSION_DETAILS } from './booking-view.mapper';
import { lockStaffSessions } from './staff-session-lock';

/** Las citas confirmadas que ya han llegado a su hora, siguen en curso y nadie ha iniciado. */
function listDueBookings(
  client: TenantTransactionClient,
  now: Date,
): Promise<BookingWithSessionDetails[]> {
  return client.booking.findMany({
    where: {
      status: 'confirmed',
      startedAt: null,
      classSession: {
        status: 'scheduled',
        startsAt: { lte: now },
        endsAt: { gt: now },
        staffMembershipId: { not: null },
      },
    },
    include: WITH_SESSION_DETAILS,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
}

async function listSessionIdsAlreadyStarted(
  client: TenantTransactionClient,
  sessionIds: readonly string[],
): Promise<Set<string>> {
  const started = await client.booking.findMany({
    where: { startedAt: { not: null }, classSessionId: { in: [...sessionIds] } },
    select: { classSessionId: true },
  });
  return new Set(started.map(({ classSessionId }) => classSessionId));
}

async function listStaffWithOpenSession(
  client: TenantTransactionClient,
  staffMembershipIds: readonly string[],
): Promise<Set<string>> {
  const open = await client.booking.findMany({
    where: {
      startedAt: { not: null },
      endedAt: null,
      classSession: { staffMembershipId: { in: [...staffMembershipIds] } },
    },
    select: { classSession: { select: { staffMembershipId: true } } },
  });
  return new Set(open.flatMap(({ classSession }) => classSession.staffMembershipId ?? []));
}

/**
 * Inicia a su hora las citas y clases del centro, como si quien atiende pulsase «Iniciar»: una sola
 * reserva por clase (la más antigua), solo si esa persona no tiene otra abierta y la cita no está
 * bloqueada por un reembolso. Devuelve cuántas inició.
 */
export async function startDueBookings(
  client: TenantTransactionClient,
  now: Date,
): Promise<number> {
  const due = await listDueBookings(client, now);
  if (due.length === 0) return 0;

  const staffIds = [
    ...new Set(due.flatMap(({ classSession }) => classSession.staffMembershipId ?? [])),
  ];
  for (const staffMembershipId of staffIds) await lockStaffSessions(client, staffMembershipId);
  const startedSessionIds = await listSessionIdsAlreadyStarted(
    client,
    due.map(({ classSessionId }) => classSessionId),
  );
  const busyStaffIds = await listStaffWithOpenSession(client, staffIds);
  const blockedIds = await findBookingsBlockedByRefund(client, { bookings: due, now });

  const idsToStart: string[] = [];
  for (const booking of due) {
    const staffMembershipId = booking.classSession.staffMembershipId;
    if (staffMembershipId === null || blockedIds.has(booking.id)) continue;
    if (startedSessionIds.has(booking.classSessionId) || busyStaffIds.has(staffMembershipId)) {
      continue;
    }
    startedSessionIds.add(booking.classSessionId);
    busyStaffIds.add(staffMembershipId);
    idsToStart.push(booking.id);
  }
  if (idsToStart.length === 0) return 0;

  const started = await client.booking.updateMany({
    where: { id: { in: idsToStart }, startedAt: null },
    data: { startedAt: now },
  });
  return started.count;
}
