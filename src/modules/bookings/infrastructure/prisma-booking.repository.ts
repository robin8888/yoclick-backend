import { Injectable } from '@nestjs/common';
import { type Prisma } from '../../../generated/prisma/client';
import { TenantPrismaService } from '../../../shared/database/tenant-prisma.service';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { getUtcRangeOfLocalDates } from '../../../shared/time/zoned-time';
import {
  type AgendaEntryView,
  type BookingListScope,
  type BookingRepository,
  type BookingView,
  type CancellationFacts,
  type CreateBookingCommand,
  type CreateBookingOutcome,
  type DayAgenda,
} from '../application/ports/booking.repository';
import { createBookingInTransaction } from './booking-creation';
import { toBookingView, WITH_SESSION_DETAILS } from './booking-view.mapper';

interface StoredCancelPolicy {
  readonly freeCancellationHours: number;
}

function buildScopeFilter(scope: BookingListScope, now: Date): Prisma.BookingWhereInput {
  // «Próximas»: no canceladas y que aún no han terminado. Todo lo demás es historial.
  if (scope === 'upcoming') {
    return { status: { not: 'cancelled' }, classSession: { endsAt: { gt: now } } };
  }
  return { OR: [{ status: 'cancelled' }, { classSession: { endsAt: { lte: now } } }] };
}

@Injectable()
export class PrismaBookingRepository implements BookingRepository {
  constructor(private readonly tenantPrismaService: TenantPrismaService) {}

  async createBooking(
    actor: ActorContext,
    command: CreateBookingCommand,
  ): Promise<CreateBookingOutcome> {
    return this.tenantPrismaService.runInTenantContext(actor, (client) =>
      createBookingInTransaction(client, actor, command),
    );
  }

  async listClientBookings(
    actor: ActorContext,
    query: { scope: BookingListScope; limit: number; now: Date },
  ): Promise<BookingView[]> {
    const sortDirection = query.scope === 'upcoming' ? 'asc' : 'desc';
    const bookings = await this.tenantPrismaService.runInTenantContext(actor, (client) =>
      client.booking.findMany({
        where: {
          clientMembershipId: actor.membershipId,
          ...buildScopeFilter(query.scope, query.now),
        },
        include: WITH_SESSION_DETAILS,
        orderBy: [{ classSession: { startsAt: sortDirection } }, { id: sortDirection }],
        take: query.limit,
      }),
    );
    return bookings.map(toBookingView);
  }

  async findCancellationFacts(
    actor: ActorContext,
    bookingId: string,
  ): Promise<CancellationFacts | null> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      // Por id Y por dueño: la reserva de otra persona es indistinguible de una inexistente (BOLA).
      const booking = await client.booking.findFirst({
        where: { id: bookingId, clientMembershipId: actor.membershipId },
        include: WITH_SESSION_DETAILS,
      });
      if (!booking) return null;
      const center = await client.center.findFirstOrThrow({ select: { cancelPolicy: true } });
      // Escrito por esta API tras validarlo con zod (ajustes del centro).
      const policy = center.cancelPolicy as StoredCancelPolicy | null;
      return {
        booking: toBookingView(booking),
        serviceCancelNoticeMinutes: booking.classSession.service.cancelNoticeMinutes,
        centerFreeCancellationHours: policy?.freeCancellationHours ?? null,
      };
    });
  }

  async markCancelled(
    actor: ActorContext,
    cancellation: { bookingId: string; cancelledAt: Date; isWithinPolicy: boolean },
  ): Promise<BookingView | null> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      // Un solo UPDATE condicionado a "sigue confirmada": dos cancelaciones a la vez no se pisan.
      const result = await client.booking.updateMany({
        where: {
          id: cancellation.bookingId,
          clientMembershipId: actor.membershipId,
          status: 'confirmed',
        },
        data: {
          status: 'cancelled',
          cancelledAt: cancellation.cancelledAt,
          cancelledBy: 'client',
          cancelWithinPolicy: cancellation.isWithinPolicy,
        },
      });
      if (result.count !== 1) return null;
      const booking = await client.booking.findUniqueOrThrow({
        where: { id: cancellation.bookingId },
        include: WITH_SESSION_DETAILS,
      });
      // Libera el hueco de la persona del equipo (la restricción EXCLUDE solo mira sesiones programadas).
      await client.classSession.update({
        where: { id: booking.classSessionId },
        data: { status: 'cancelled' },
      });
      return toBookingView(booking);
    });
  }

  async listDayAgenda(
    actor: ActorContext,
    query: { date: string; staffMembershipId: string | null },
  ): Promise<DayAgenda> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const center = await client.center.findFirstOrThrow({ select: { timezone: true } });
      const range = getUtcRangeOfLocalDates(query.date, query.date, center.timezone);
      const bookings = await client.booking.findMany({
        where: {
          classSession: {
            startsAt: { gte: range.startsAt, lt: range.endsAt },
            ...(query.staffMembershipId !== null && {
              staffMembershipId: query.staffMembershipId,
            }),
          },
        },
        include: {
          ...WITH_SESSION_DETAILS,
          clientMembership: { select: { id: true, user: { select: { fullName: true } } } },
        },
        orderBy: [{ classSession: { startsAt: 'asc' } }, { id: 'asc' }],
      });
      const entries: AgendaEntryView[] = bookings.map((booking) => ({
        booking: toBookingView(booking),
        client: {
          membershipId: booking.clientMembership.id,
          fullName: booking.clientMembership.user.fullName,
        },
      }));
      return { timeZone: center.timezone, entries };
    });
  }
}
