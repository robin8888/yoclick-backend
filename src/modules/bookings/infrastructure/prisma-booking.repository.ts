import { Injectable } from '@nestjs/common';
import { type Prisma } from '../../../generated/prisma/client';
import {
  TenantPrismaService,
  type TenantTransactionClient,
} from '../../../shared/database/tenant-prisma.service';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { getUtcRangeOfLocalDates } from '../../../shared/time/zoned-time';
import {
  listOpeningRangesOfDate,
  type OpeningHours,
  type OpeningInterval,
} from '../../centers/domain/opening-hours';
import {
  type AgendaEntryView,
  type BookingListScope,
  type BookingRepository,
  type BookingView,
  type CancellationFacts,
  type CreateBookingCommand,
  type CreateBookingOutcome,
  type DayAgenda,
  type TeamCancellationOutcome,
} from '../application/ports/booking.repository';
import { recordBookingNotification } from '../../notifications/infrastructure/booking-notification.recorder';
import { createBookingInTransaction } from './booking-creation';
import {
  toBookingView,
  WITH_SESSION_DETAILS,
  type BookingWithSessionDetails,
} from './booking-view.mapper';

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

interface CenterSchedule {
  readonly openingHours: unknown;
  readonly holidays: unknown;
}

/** Los tramos de apertura de una fecha local. Ajustes escritos por esta API tras validarlos con zod. */
function listOpeningRangesOfCenterDate(center: CenterSchedule, date: string): OpeningInterval[] {
  const holidayDates = ((center.holidays ?? []) as { date: string }[]).map(({ date: day }) => day);
  return [
    ...listOpeningRangesOfDate(center.openingHours as OpeningHours | null, holidayDates, date),
  ];
}

/** Avisa a quien da la cita y a administración de que el cliente la ha cancelado. */
async function recordCancellationNotice(
  client: TenantTransactionClient,
  actor: ActorContext,
  booking: BookingWithSessionDetails,
): Promise<void> {
  await recordBookingNotification(client, {
    centerId: actor.centerId,
    change: 'cancelled',
    bookingId: booking.id,
    clientMembershipId: booking.clientMembershipId,
    staffMembershipId: booking.classSession.staffMembership.id,
    serviceName: booking.classSession.service.name,
    startsAt: booking.classSession.startsAt,
    actorMembershipId: actor.membershipId,
  });
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
          // Una clase ya iniciada (se puede abrir 15 min antes) deja de poder cancelarse.
          startedAt: null,
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
      await recordCancellationNotice(client, actor, booking);
      return toBookingView(booking);
    });
  }

  async cancelByTeam(
    actor: ActorContext,
    request: { bookingId: string; now: Date },
  ): Promise<TeamCancellationOutcome> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const booking = await client.booking.findFirst({
        where: {
          id: request.bookingId,
          ...(actor.role === 'staff' && {
            classSession: { staffMembershipId: actor.membershipId },
          }),
        },
        include: WITH_SESSION_DETAILS,
      });
      if (!booking) return { kind: 'not_found' } as const;
      const isCancellable =
        booking.status === 'confirmed' &&
        booking.startedAt === null &&
        booking.classSession.startsAt > request.now;
      if (!isCancellable) return { kind: 'not_cancellable' } as const;

      await client.booking.update({
        where: { id: booking.id },
        data: { status: 'cancelled', cancelledAt: request.now, cancelledBy: 'staff' },
      });
      await client.classSession.update({
        where: { id: booking.classSessionId },
        data: { status: 'cancelled' },
      });
      await recordCancellationNotice(client, actor, booking);
      const cancelled = await client.booking.findUniqueOrThrow({
        where: { id: booking.id },
        include: WITH_SESSION_DETAILS,
      });
      return { kind: 'cancelled', booking: toBookingView(cancelled) } as const;
    });
  }

  async listDayAgenda(
    actor: ActorContext,
    query: { date: string; staffMembershipId: string | null },
  ): Promise<DayAgenda> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const center = await client.center.findFirstOrThrow({
        select: { timezone: true, openingHours: true, holidays: true },
      });
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
      return {
        timeZone: center.timezone,
        openingRanges: listOpeningRangesOfCenterDate(center, query.date),
        entries,
      };
    });
  }
}
