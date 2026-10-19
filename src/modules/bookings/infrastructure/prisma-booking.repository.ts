import { requireTeacher } from './require-teacher';
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
  type EmptySessionView,
  type BookingListScope,
  type BookingRepository,
  type BookingView,
  type CancellationFacts,
  type CreateBookingCommand,
  type CreateBookingOutcome,
  type DayAgenda,
  type GroupOptions,
  type GroupOptionsQuery,
  type JoinGroupSessionCommand,
  type JoinGroupSessionOutcome,
  type PlacementOptions,
  type PlacementOptionsQuery,
  type MoveToSessionCommand,
  type RescheduleBookingCommand,
  type RescheduleOutcome,
  type RoomAgenda,
  type ServiceSessionsQuery,
  type ServiceSessionsView,
  type TeamCancellationOutcome,
} from '../application/ports/booking.repository';
import { recordBookingNotification } from '../../notifications/infrastructure/booking-notification.recorder';
import { createBookingInTransaction, joinGroupSessionInTransaction } from './booking-creation';
import {
  listGroupOptionsInTransaction,
  listPlacementOptionsInTransaction,
} from './placement-options';
import { listRoomAgendaInTransaction } from './room-agenda';
import { moveBookingToSessionInTransaction } from './booking-move';
import { listServiceSessionsInTransaction } from './service-sessions';
import { releaseSessionIfEmpty } from './session-release';
import {
  rescheduleBookingInTransaction,
  rescheduleByTeamInTransaction,
} from './booking-rescheduling';
import {
  markBlockedBookings,
  toBookingView,
  WITH_SESSION_DETAILS,
  type BookingWithSessionDetails,
} from './booking-view.mapper';
import { restorePassForBooking } from '../../passes/infrastructure/pass-restoration';

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
    staffMembershipId: requireTeacher(booking.classSession.staffMembership).id,
    serviceName: booking.classSession.service.name,
    startsAt: booking.classSession.startsAt,
    actorMembershipId: actor.membershipId,
  });
}

/**
 * El mismo actor con la visibilidad de las reservas del equipo (la política `client_own` deja a un
 * cliente ver solo las suyas). Solo para contar plazas: nunca devuelve reservas ajenas.
 */
function withTeamVisibility(actor: ActorContext): ActorContext {
  return { ...actor, role: 'staff' };
}

type StoredAgendaBooking = BookingWithSessionDetails & {
  clientMembership: { id: string; user: { fullName: string; photoKey: string | null } };
};

/** Las clases programadas del día en las que nadie está apuntado (las canceladas no cuentan). */
async function listEmptySessions(
  client: TenantTransactionClient,
  input: { range: { startsAt: Date; endsAt: Date }; staffMembershipId: string | null },
): Promise<EmptySessionView[]> {
  const sessions = await client.classSession.findMany({
    where: {
      status: 'scheduled',
      startsAt: { gte: input.range.startsAt, lt: input.range.endsAt },
      bookings: { none: { status: { not: 'cancelled' } } },
      ...(input.staffMembershipId !== null && { staffMembershipId: input.staffMembershipId }),
    },
    include: {
      service: { select: { id: true, name: true } },
      room: { select: { id: true, name: true } },
      staffMembership: { select: { id: true, user: { select: { fullName: true } } } },
    },
    orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
  });
  return sessions.map((session) => ({
    id: session.id,
    startsAt: session.startsAt,
    endsAt: session.endsAt,
    mode: session.mode,
    capacity: session.capacity,
    service: session.service,
    room: session.room,
    staff:
      session.staffMembership === null
        ? null
        : {
            membershipId: session.staffMembership.id,
            fullName: session.staffMembership.user.fullName,
          },
  }));
}

function toAgendaEntry(booking: StoredAgendaBooking, view: BookingView): AgendaEntryView {
  return {
    booking: view,
    client: {
      membershipId: booking.clientMembership.id,
      fullName: booking.clientMembership.user.fullName,
      photoKey: booking.clientMembership.user.photoKey,
    },
  };
}

/** Las citas del día con su cliente y, en cada una, si está bloqueada por un reembolso total. */
async function buildAgendaEntries(
  client: TenantTransactionClient,
  input: { bookings: readonly StoredAgendaBooking[]; now: Date },
): Promise<AgendaEntryView[]> {
  const views = await markBlockedBookings(client, input);
  const storedById = new Map(input.bookings.map((booking) => [booking.id, booking]));
  return views.flatMap((view) => {
    const stored = storedById.get(view.id);
    return stored === undefined ? [] : [toAgendaEntry(stored, view)];
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

  async joinGroupSession(
    actor: ActorContext,
    command: JoinGroupSessionCommand,
  ): Promise<JoinGroupSessionOutcome> {
    // Para contar las plazas hay que ver todas las reservas de la clase, no solo las del cliente:
    // la consulta corre con la visibilidad del equipo, pero la reserva se firma con el actor real.
    return this.tenantPrismaService.runInTenantContext(withTeamVisibility(actor), (client) =>
      joinGroupSessionInTransaction(client, actor, command),
    );
  }

  async listServiceSessions(
    actor: ActorContext,
    query: ServiceSessionsQuery,
  ): Promise<ServiceSessionsView | null> {
    // Las plazas libres cuentan las reservas de todos, también para un cliente que consulta.
    return this.tenantPrismaService.runInTenantContext(withTeamVisibility(actor), (client) =>
      listServiceSessionsInTransaction(client, query),
    );
  }

  async listRoomAgenda(actor: ActorContext, query: { date: string }): Promise<RoomAgenda> {
    return this.tenantPrismaService.runInTenantContext(actor, (client) =>
      listRoomAgendaInTransaction(client, query.date),
    );
  }

  async listGroupOptions(
    actor: ActorContext,
    query: GroupOptionsQuery,
  ): Promise<GroupOptions | null> {
    return this.tenantPrismaService.runInTenantContext(actor, (client) =>
      listGroupOptionsInTransaction(client, query),
    );
  }

  async listPlacementOptions(
    actor: ActorContext,
    query: PlacementOptionsQuery,
  ): Promise<PlacementOptions | null> {
    return this.tenantPrismaService.runInTenantContext(actor, (client) =>
      listPlacementOptionsInTransaction(client, query),
    );
  }

  async rescheduleBooking(
    actor: ActorContext,
    command: RescheduleBookingCommand,
  ): Promise<RescheduleOutcome> {
    return this.tenantPrismaService.runInTenantContext(actor, (client) =>
      rescheduleBookingInTransaction(client, actor, command),
    );
  }

  async moveToSession(
    actor: ActorContext,
    command: MoveToSessionCommand,
  ): Promise<RescheduleOutcome> {
    // Las plazas de la clase nueva se cuentan con la visibilidad del equipo; la reserva que se
    // mueve se busca por dueño, así que nunca se toca una ajena.
    return this.tenantPrismaService.runInTenantContext(withTeamVisibility(actor), (client) =>
      moveBookingToSessionInTransaction(client, actor, command),
    );
  }

  async rescheduleByTeam(
    actor: ActorContext,
    command: RescheduleBookingCommand,
  ): Promise<RescheduleOutcome> {
    return this.tenantPrismaService.runInTenantContext(actor, (client) =>
      rescheduleByTeamInTransaction(client, actor, command),
    );
  }

  async listClientBookings(
    actor: ActorContext,
    query: { scope: BookingListScope; limit: number; now: Date },
  ): Promise<BookingView[]> {
    const sortDirection = query.scope === 'upcoming' ? 'asc' : 'desc';
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const bookings = await client.booking.findMany({
        where: {
          clientMembershipId: actor.membershipId,
          ...buildScopeFilter(query.scope, query.now),
        },
        include: WITH_SESSION_DETAILS,
        orderBy: [{ classSession: { startsAt: sortDirection } }, { id: sortDirection }],
        take: query.limit,
      });
      return markBlockedBookings(client, { bookings, now: query.now });
    });
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
    // Con la visibilidad del equipo para ver si en la clase grupal queda alguien más apuntado: con la
    // del cliente solo vería su propia reserva y daría la clase por vacía. La reserva que se cancela
    // se sigue buscando por dueño, así que nunca se toca una ajena.
    return this.tenantPrismaService.runInTenantContext(
      withTeamVisibility(actor),
      async (client) => {
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
        // Libera el hueco de la persona y de la sala (la restricción EXCLUDE solo mira sesiones
        // programadas), salvo que en una clase grupal quede alguien más apuntado.
        await releaseSessionIfEmpty(client, booking.classSessionId);
        await restorePassForBooking(client, { bookingId: booking.id });
        await recordCancellationNotice(client, actor, booking);
        return toBookingView(booking);
      },
    );
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
      await releaseSessionIfEmpty(client, booking.classSessionId);
      await restorePassForBooking(client, { bookingId: booking.id });
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
    query: { date: string; staffMembershipId: string | null; now: Date },
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
          clientMembership: {
            select: { id: true, user: { select: { fullName: true, photoKey: true } } },
          },
        },
        orderBy: [{ classSession: { startsAt: 'asc' } }, { id: 'asc' }],
      });
      const entries = await buildAgendaEntries(client, { bookings, now: query.now });
      const emptySessions = await listEmptySessions(client, {
        range,
        staffMembershipId: query.staffMembershipId,
      });
      return {
        timeZone: center.timezone,
        openingRanges: listOpeningRangesOfCenterDate(center, query.date),
        entries,
        emptySessions,
      };
    });
  }
}
