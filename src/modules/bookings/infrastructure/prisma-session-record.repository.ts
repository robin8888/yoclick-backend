import { Injectable } from '@nestjs/common';
import {
  TenantPrismaService,
  type TenantTransactionClient,
} from '../../../shared/database/tenant-prisma.service';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { getUtcRangeOfLocalDates } from '../../../shared/time/zoned-time';
import {
  type EndSessionOutcome,
  type SessionRecordEntry,
  type SessionRecordRepository,
  type SessionRecordsFound,
  type SessionRecordsQuery,
  type StartSessionOutcome,
} from '../application/ports/session-record.repository';
import { decideSessionEnd, decideSessionStart } from '../domain/session-record';
import {
  toBookingView,
  WITH_SESSION_DETAILS,
  type BookingWithSessionDetails,
} from './booking-view.mapper';

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

/** Un cerrojo por persona del equipo y transacción: dos «iniciar» suyos a la vez se atienden de uno en uno. */
async function lockStaffSessions(
  client: TenantTransactionClient,
  staffMembershipId: string,
): Promise<void> {
  await client.$executeRaw`select pg_advisory_xact_lock(hashtextextended(${staffMembershipId}, 0))`;
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
      await lockStaffSessions(client, staffMembershipId);

      // Se vuelve a leer ya con el cerrojo: otra petición pudo iniciarla mientras esperábamos.
      const booking = toBookingView(await reloadBooking(client, command.bookingId));
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
      const booking = toBookingView(await reloadBooking(client, command.bookingId));
      if (closed.count === 1) return { kind: 'ended', booking };
      return decideSessionEnd(booking) === 'already_ended'
        ? { kind: 'already_ended', booking }
        : { kind: 'not_started' };
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
