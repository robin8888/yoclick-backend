import { requireTeacher } from './require-teacher';
import { Injectable } from '@nestjs/common';
import {
  TenantPrismaService,
  type TenantTransactionClient,
} from '../../../shared/database/tenant-prisma.service';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { MILLISECONDS_PER_MINUTE } from '../../../shared/time/time-units';
import { getUtcRangeOfLocalDates } from '../../../shared/time/zoned-time';
import {
  type ConfirmAttendanceOutcome,
  type EndSessionOutcome,
  type SessionRecordEntry,
  type SessionRecordRepository,
  type SessionRecordsFound,
  type SessionRecordsQuery,
  type StartSessionOutcome,
} from '../application/ports/session-record.repository';
import { CHECKIN_EARLY_MINUTES } from '../domain/check-in';
import { decideSessionEnd, decideSessionStart } from '../domain/session-record';
import {
  toBookingView,
  WITH_SESSION_DETAILS,
  type BookingWithSessionDetails,
} from './booking-view.mapper';
import { startDueBookings } from './session-auto-start';
import { lockStaffSessions } from './staff-session-lock';
import { consumePassForBooking } from '../../passes/infrastructure/pass-consumption';
import { findBookingsBlockedByRefund } from '../../passes/infrastructure/refund-block';

/**
 * La reserva que esta persona puede mover: el personal solo las suyas, administración todas las del
 * centro. Cualquier otra es indistinguible de una inexistente (BOLA), y la RLS acota el centro.
 */
function findManageableBooking(
  client: TenantTransactionClient,
  actor: ActorContext,
  bookingId: string,
): Promise<BookingWithSessionDetails | null> {
  return client.booking.findFirst({
    where: {
      id: bookingId,
      ...(actor.role === 'staff' && { classSession: { staffMembershipId: actor.membershipId } }),
    },
    include: WITH_SESSION_DETAILS,
  });
}

function reloadBooking(
  client: TenantTransactionClient,
  bookingId: string,
): Promise<BookingWithSessionDetails> {
  return client.booking.findUniqueOrThrow({
    where: { id: bookingId },
    include: WITH_SESSION_DETAILS,
  });
}

/** Si la cita está bloqueada por un reembolso total: no se inicia ni se confirma hasta tener bono nuevo. */
async function isBlockedUntilNewPass(
  client: TenantTransactionClient,
  input: { booking: BookingWithSessionDetails; now: Date },
): Promise<boolean> {
  const blockedIds = await findBookingsBlockedByRefund(client, {
    bookings: [input.booking],
    now: input.now,
  });
  return blockedIds.has(input.booking.id);
}

@Injectable()
export class PrismaSessionRecordRepository implements SessionRecordRepository {
  constructor(private readonly tenantPrismaService: TenantPrismaService) {}

  async startSession(
    actor: ActorContext,
    command: { bookingId: string; now: Date },
  ): Promise<StartSessionOutcome> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const visible = await findManageableBooking(client, actor, command.bookingId);
      if (!visible) return { kind: 'not_found' };
      const staffMembershipId = visible.classSession.staffMembershipId;
      await lockStaffSessions(client, requireTeacher(staffMembershipId));

      // Se vuelve a leer ya con el cerrojo: otra petición pudo iniciarla mientras esperábamos.
      const reloaded = await reloadBooking(client, command.bookingId);
      const booking = toBookingView(reloaded);
      if (await isBlockedUntilNewPass(client, { booking: reloaded, now: command.now })) {
        return { kind: 'pass_required' };
      }
      const verdict = decideSessionStart({ ...booking, now: command.now });
      if (verdict === 'already_started') return { kind: 'already_started', booking };
      if (verdict === 'not_startable') return { kind: 'not_startable' };

      const openCount = await client.booking.count({
        where: { startedAt: { not: null }, endedAt: null, classSession: { staffMembershipId } },
      });
      if (openCount > 0) return { kind: 'session_already_open' };

      await client.booking.update({
        where: { id: command.bookingId },
        data: { startedAt: command.now, startedByMembershipId: actor.membershipId },
      });
      const started = toBookingView(await reloadBooking(client, command.bookingId));
      return { kind: 'started', booking: started };
    });
  }

  async findCentersWithAutoStart(): Promise<string[]> {
    return this.tenantPrismaService.runInAutoStartSweepContext(async (client) => {
      const centers = await client.center.findMany({
        where: { autoStartSessions: true },
        select: { id: true },
      });
      return centers.map(({ id }) => id);
    });
  }

  async startDueSessions(actor: ActorContext, command: { now: Date }): Promise<number> {
    return this.tenantPrismaService.runInTenantContext(actor, (client) =>
      startDueBookings(client, command.now),
    );
  }

  async endSession(
    actor: ActorContext,
    command: { bookingId: string; now: Date; notes: string | null },
  ): Promise<EndSessionOutcome> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const visible = await findManageableBooking(client, actor, command.bookingId);
      if (!visible) return { kind: 'not_found' };

      // UPDATE condicionado a «iniciada y sin terminar»: dos cierres a la vez no se pisan.
      const closed = await client.booking.updateMany({
        where: {
          id: command.bookingId,
          status: 'confirmed',
          startedAt: { not: null },
          endedAt: null,
        },
        data: {
          endedAt: command.now,
          endedByMembershipId: actor.membershipId,
          status: 'attended',
          sessionNotes: command.notes,
        },
      });
      // Cerrar la clase la da por asistida; si ya se descontó al llegar, no se descuenta otra vez.
      if (closed.count === 1) {
        await consumePassForBooking(client, { bookingId: command.bookingId, now: command.now });
      }
      const booking = toBookingView(await reloadBooking(client, command.bookingId));
      if (closed.count === 1) return { kind: 'ended', booking };
      return decideSessionEnd(booking) === 'already_ended'
        ? { kind: 'already_ended', booking }
        : { kind: 'not_started' };
    });
  }

  async confirmAttendance(
    actor: ActorContext,
    command: { bookingId: string; now: Date },
  ): Promise<ConfirmAttendanceOutcome> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const visible = await findManageableBooking(client, actor, command.bookingId);
      if (!visible) return { kind: 'not_found' };
      const opensAt =
        visible.classSession.startsAt.getTime() - CHECKIN_EARLY_MINUTES * MILLISECONDS_PER_MINUTE;
      const isConfirmable = visible.status !== 'cancelled' && command.now.getTime() >= opensAt;
      if (!isConfirmable) return { kind: 'not_confirmable' };
      if (await isBlockedUntilNewPass(client, { booking: visible, now: command.now })) {
        return { kind: 'pass_required' };
      }

      // UPDATE condicionado a «aún sin confirmar»: dos checks a la vez no descuentan dos veces.
      const confirmed = await client.booking.updateMany({
        where: { id: command.bookingId, checkedInAt: null },
        data: {
          checkedInAt: command.now,
          checkedInByMembershipId: actor.membershipId,
          // Si ya se había dado por «no se presentó», vino: la confirmación lo corrige.
          ...(visible.status === 'no_show' && { status: 'attended' as const }),
        },
      });
      if (confirmed.count === 1) {
        await consumePassForBooking(client, { bookingId: command.bookingId, now: command.now });
      }
      const booking = toBookingView(await reloadBooking(client, command.bookingId));
      return { kind: confirmed.count === 1 ? 'confirmed' : 'already_confirmed', booking };
    });
  }

  async listSessionRecords(
    actor: ActorContext,
    query: SessionRecordsQuery,
  ): Promise<SessionRecordsFound> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const center = await client.center.findFirstOrThrow({ select: { timezone: true } });
      const range = getUtcRangeOfLocalDates(query.fromDate, query.toDate, center.timezone);
      const bookings = await client.booking.findMany({
        where: {
          classSession: {
            startsAt: { gte: range.startsAt, lt: range.endsAt },
            ...(query.staffMembershipId !== null && {
              staffMembershipId: query.staffMembershipId,
            }),
          },
          // Las iniciadas y las que ya pasaron de hora sin que nadie las iniciara («no registradas»).
          OR: [
            { startedAt: { not: null } },
            { status: 'confirmed', classSession: { endsAt: { lte: query.now } } },
          ],
        },
        include: {
          ...WITH_SESSION_DETAILS,
          clientMembership: { select: { id: true, user: { select: { fullName: true } } } },
        },
        orderBy: [{ classSession: { startsAt: 'asc' } }, { id: 'asc' }],
      });
      const entries: SessionRecordEntry[] = bookings.map((booking) => ({
        booking: toBookingView(booking),
        client: {
          membershipId: booking.clientMembership.id,
          fullName: booking.clientMembership.user.fullName,
        },
        notes: booking.sessionNotes,
      }));
      return { timeZone: center.timezone, entries };
    });
  }
}
