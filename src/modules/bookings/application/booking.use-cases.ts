import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '../../../shared/errors/domain-error';
import { HTTP_STATUS } from '../../../shared/errors/http-status';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { PhotoUrlSigner, type WithPhotoUrl } from '../../photos/application/photo-url-signer';
import {
  decideCancellation,
  isCancellationWithinPolicy,
  resolveCancellationNoticeMinutes,
} from '../domain/cancellation-policy';
import {
  BOOKING_REPOSITORY,
  type AgendaEntryView,
  type BookingListScope,
  type BookingRepository,
  type BookingView,
  type CreateBookingCommand,
  type CreateBookingOutcome,
  type DayAgenda,
  type GroupOptions,
  type GroupOptionsQuery,
  type JoinGroupSessionCommand,
  type PlacementOptions,
  type PlacementOptionsQuery,
  type RoomAgenda,
  type ServiceSessionsQuery,
  type ServiceSessionsView,
  type RoomDayView,
  type RoomSessionView,
  type MoveToSessionCommand,
  type RescheduleBookingCommand,
  type RescheduleOutcome,
} from './ports/booking.repository';

const REFUSALS_BY_OUTCOME: Readonly<
  Record<
    Exclude<CreateBookingOutcome['kind'], 'created'>,
    ConstructorParameters<typeof DomainError>
  >
> = {
  service_not_found: ['NOT_FOUND', HTTP_STATUS.notFound],
  client_not_found: ['NOT_FOUND', HTTP_STATUS.notFound],
  outside_window: ['OUTSIDE_BOOKING_WINDOW', HTTP_STATUS.conflict],
  slot_unavailable: ['SLOT_UNAVAILABLE', HTTP_STATUS.conflict],
  already_booked: ['ALREADY_BOOKED', HTTP_STATUS.conflict],
  room_unavailable: ['ROOM_UNAVAILABLE', HTTP_STATUS.conflict],
  mode_not_allowed: ['SESSION_MODE_NOT_ALLOWED', HTTP_STATUS.conflict],
  service_scheduled_only: ['SERVICE_ONLY_IN_SCHEDULE', HTTP_STATUS.conflict],
};

/** Reservar un hueco individual. La hora se vuelve a comprobar en el servidor, nunca se confía en la app. */
@Injectable()
export class CreateBookingUseCase {
  constructor(@Inject(BOOKING_REPOSITORY) private readonly bookings: BookingRepository) {}

  async execute(actor: ActorContext, command: CreateBookingCommand): Promise<BookingView> {
    const outcome = await this.bookings.createBooking(actor, command);
    if (outcome.kind === 'created') return outcome.booking;
    throw new DomainError(...REFUSALS_BY_OUTCOME[outcome.kind]);
  }
}

/** Apuntar a un cliente a una clase grupal que ya existe, mientras queden plazas. */
@Injectable()
export class JoinGroupSessionUseCase {
  constructor(@Inject(BOOKING_REPOSITORY) private readonly bookings: BookingRepository) {}

  async execute(actor: ActorContext, command: JoinGroupSessionCommand): Promise<BookingView> {
    const outcome = await this.bookings.joinGroupSession(actor, command);
    if (outcome.kind === 'created') return outcome.booking;
    if (outcome.kind === 'session_full') {
      throw new DomainError('SESSION_FULL', HTTP_STATUS.conflict);
    }
    if (outcome.kind === 'already_booked') {
      throw new DomainError('ALREADY_BOOKED', HTTP_STATUS.conflict);
    }
    if (outcome.kind === 'outside_window') {
      throw new DomainError('OUTSIDE_BOOKING_WINDOW', HTTP_STATUS.conflict);
    }
    if (outcome.kind === 'pass_fully_booked') {
      throw new DomainError('PASS_FULLY_BOOKED', HTTP_STATUS.conflict);
    }
    if (outcome.kind === 'client_has_no_pass') {
      throw new DomainError('CLIENT_HAS_NO_PASS', HTTP_STATUS.conflict);
    }
    throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
  }
}

/** Horas libres de una persona del equipo con sus salas libres, y los grupos a los que aún caben más. */
@Injectable()
export class GetPlacementOptionsUseCase {
  constructor(@Inject(BOOKING_REPOSITORY) private readonly bookings: BookingRepository) {}

  async execute(actor: ActorContext, query: PlacementOptionsQuery): Promise<PlacementOptions> {
    const options = await this.bookings.listPlacementOptions(actor, query);
    if (!options) throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
    return options;
  }
}

type SignedRoomSession = Omit<RoomSessionView, 'attendees'> & {
  readonly attendees: readonly WithPhotoUrl<RoomSessionView['attendees'][number]>[];
};
type SignedRoomAgenda = Omit<RoomAgenda, 'rooms' | 'sessionsWithoutRoom'> & {
  readonly rooms: readonly (Omit<RoomDayView, 'sessions'> & {
    readonly sessions: readonly SignedRoomSession[];
  })[];
  readonly sessionsWithoutRoom: readonly SignedRoomSession[];
};

/** La agenda del centro por sala: cuándo está ocupada cada una y con qué clase, profesor y alumnos. */
@Injectable()
export class GetRoomAgendaUseCase {
  constructor(
    @Inject(BOOKING_REPOSITORY) private readonly bookings: BookingRepository,
    private readonly urlSigner: PhotoUrlSigner,
  ) {}

  async execute(actor: ActorContext, query: { date: string }): Promise<SignedRoomAgenda> {
    const agenda = await this.bookings.listRoomAgenda(actor, query);
    const signSession = (session: RoomSessionView): SignedRoomSession => ({
      ...session,
      attendees: session.attendees.map((attendee) => this.urlSigner.attachPhotoUrl(attendee)),
    });
    return {
      ...agenda,
      rooms: agenda.rooms.map((room) => ({ ...room, sessions: room.sessions.map(signSession) })),
      sessionsWithoutRoom: agenda.sessionsWithoutRoom.map(signSession),
    };
  }
}

/** Las clases de un servicio con plazas libres: lo que se ofrece al asignar o pedir una cita. */
@Injectable()
export class ListServiceSessionsUseCase {
  constructor(@Inject(BOOKING_REPOSITORY) private readonly bookings: BookingRepository) {}

  async execute(actor: ActorContext, query: ServiceSessionsQuery): Promise<ServiceSessionsView> {
    const view = await this.bookings.listServiceSessions(actor, query);
    if (!view) throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
    return view;
  }
}

/** Salas con profesor, con sus horas libres y grupos con plazas, para asignar una cita grupal. */
@Injectable()
export class GetGroupOptionsUseCase {
  constructor(@Inject(BOOKING_REPOSITORY) private readonly bookings: BookingRepository) {}

  async execute(actor: ActorContext, query: GroupOptionsQuery): Promise<GroupOptions> {
    const options = await this.bookings.listGroupOptions(actor, query);
    if (!options) throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
    return options;
  }
}

const REFUSALS_BY_RESCHEDULE_OUTCOME: Readonly<
  Record<
    Exclude<RescheduleOutcome['kind'], 'rescheduled'>,
    ConstructorParameters<typeof DomainError>
  >
> = {
  ...REFUSALS_BY_OUTCOME,
  not_found: ['NOT_FOUND', HTTP_STATUS.notFound],
  not_reschedulable: ['BOOKING_NOT_RESCHEDULABLE', HTTP_STATUS.conflict],
  too_late: ['RESCHEDULE_TOO_LATE', HTTP_STATUS.conflict],
  session_full: ['SESSION_FULL', HTTP_STATUS.conflict],
};

/**
 * Cambia de hora una reserva propia con el mismo servicio. Pide la misma antelación que cancelar:
 * pasado ese plazo hay que hablar con el centro. La hora nueva se vuelve a comprobar en el servidor.
 */
@Injectable()
export class RescheduleBookingUseCase {
  constructor(@Inject(BOOKING_REPOSITORY) private readonly bookings: BookingRepository) {}

  async execute(
    actor: ActorContext,
    command: RescheduleBookingCommand,
  ): Promise<Extract<RescheduleOutcome, { kind: 'rescheduled' }>> {
    const outcome = await this.bookings.rescheduleBooking(actor, command);
    if (outcome.kind === 'rescheduled') return outcome;
    throw new DomainError(...REFUSALS_BY_RESCHEDULE_OUTCOME[outcome.kind]);
  }
}

/** El cliente pasa su reserva a otra clase con plazas del mismo servicio. */
@Injectable()
export class MoveBookingToSessionUseCase {
  constructor(@Inject(BOOKING_REPOSITORY) private readonly bookings: BookingRepository) {}

  async execute(
    actor: ActorContext,
    command: MoveToSessionCommand,
  ): Promise<Extract<RescheduleOutcome, { kind: 'rescheduled' }>> {
    const outcome = await this.bookings.moveToSession(actor, command);
    if (outcome.kind === 'rescheduled') return outcome;
    throw new DomainError(...REFUSALS_BY_RESCHEDULE_OUTCOME[outcome.kind]);
  }
}

/**
 * El equipo mueve la cita de un cliente desde la agenda. Sin antelación mínima: avisa al cliente por
 * push. La hora nueva se vuelve a comprobar en el servidor.
 */
@Injectable()
export class RescheduleBookingByTeamUseCase {
  constructor(@Inject(BOOKING_REPOSITORY) private readonly bookings: BookingRepository) {}

  async execute(
    actor: ActorContext,
    command: RescheduleBookingCommand,
  ): Promise<Extract<RescheduleOutcome, { kind: 'rescheduled' }>> {
    const outcome = await this.bookings.rescheduleByTeam(actor, command);
    if (outcome.kind === 'rescheduled') return outcome;
    throw new DomainError(...REFUSALS_BY_RESCHEDULE_OUTCOME[outcome.kind]);
  }
}

export interface ListMyBookingsRequest {
  readonly actor: ActorContext;
  readonly scope: BookingListScope;
  readonly limit: number;
  readonly now: Date;
}

@Injectable()
export class ListMyBookingsUseCase {
  constructor(@Inject(BOOKING_REPOSITORY) private readonly bookings: BookingRepository) {}

  async execute({ actor, ...query }: ListMyBookingsRequest): Promise<BookingView[]> {
    return this.bookings.listClientBookings(actor, query);
  }
}

export interface CancellationResult {
  readonly booking: BookingView;
  readonly withinPolicy: boolean;
}

/**
 * Cancela una reserva del propio cliente. Se puede cancelar fuera de plazo (queda anotado, y la
 * consecuencia económica llegará con los pagos); una ya cancelada devuelve el mismo resultado.
 */
@Injectable()
export class CancelBookingUseCase {
  constructor(@Inject(BOOKING_REPOSITORY) private readonly bookings: BookingRepository) {}

  async execute(input: {
    actor: ActorContext;
    bookingId: string;
    now: Date;
  }): Promise<CancellationResult> {
    const { actor, bookingId, now } = input;
    const facts = await this.bookings.findCancellationFacts(actor, bookingId);
    if (!facts) throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);

    const verdict = decideCancellation({
      status: facts.booking.status,
      startsAt: facts.booking.startsAt,
      now,
    });
    if (verdict === 'already_cancelled') return toResult(facts.booking);
    if (verdict === 'not_cancellable') throw notCancellable();

    const isWithinPolicy = isCancellationWithinPolicy({
      startsAt: facts.booking.startsAt,
      now,
      noticeMinutes: resolveCancellationNoticeMinutes(facts),
    });
    const cancelled = await this.bookings.markCancelled(actor, {
      bookingId,
      cancelledAt: now,
      isWithinPolicy,
    });
    return cancelled ? toResult(cancelled) : this.resolveRace(actor, bookingId);
  }

  /** Otra petición cancelló primero: si quedó cancelada es éxito; si no (p. ej. se pasó lista), no se puede. */
  private async resolveRace(actor: ActorContext, bookingId: string): Promise<CancellationResult> {
    const latest = await this.bookings.findCancellationFacts(actor, bookingId);
    if (latest?.booking.status === 'cancelled') return toResult(latest.booking);
    throw notCancellable();
  }
}

function notCancellable(): DomainError {
  return new DomainError('BOOKING_NOT_CANCELLABLE', HTTP_STATUS.conflict);
}

function toResult(booking: BookingView): CancellationResult {
  return { booking, withinPolicy: booking.cancelWithinPolicy ?? false };
}

export interface DayAgendaRequest {
  readonly actor: ActorContext;
  readonly date: string;
  readonly requestedStaffMembershipId: string | null;
}

type SignedDayAgenda = Omit<DayAgenda, 'entries'> & {
  readonly entries: readonly {
    readonly booking: BookingView;
    readonly client: WithPhotoUrl<AgendaEntryView['client']>;
  }[];
};

/** El personal solo ve su propia agenda aunque pida otra; administración ve todas o filtra por persona. */
@Injectable()
export class GetDayAgendaUseCase {
  constructor(
    @Inject(BOOKING_REPOSITORY) private readonly bookings: BookingRepository,
    private readonly urlSigner: PhotoUrlSigner,
  ) {}

  async execute(request: DayAgendaRequest): Promise<SignedDayAgenda> {
    const { actor, date, requestedStaffMembershipId } = request;
    const staffMembershipId =
      actor.role === 'staff' ? actor.membershipId : requestedStaffMembershipId;
    const agenda = await this.bookings.listDayAgenda(actor, { date, staffMembershipId });
    return {
      ...agenda,
      entries: agenda.entries.map(({ booking, client }) => ({
        booking,
        client: this.urlSigner.attachPhotoUrl(client),
      })),
    };
  }
}

/** El equipo cancela una cita desde la agenda: avisa al cliente por push. */
@Injectable()
export class CancelBookingByTeamUseCase {
  constructor(@Inject(BOOKING_REPOSITORY) private readonly bookings: BookingRepository) {}

  async execute(input: {
    actor: ActorContext;
    bookingId: string;
    now: Date;
  }): Promise<BookingView> {
    const outcome = await this.bookings.cancelByTeam(input.actor, {
      bookingId: input.bookingId,
      now: input.now,
    });
    if (outcome.kind === 'not_found') throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
    if (outcome.kind === 'not_cancellable') throw notCancellable();
    return outcome.booking;
  }
}
