import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '../../../shared/errors/domain-error';
import { HTTP_STATUS } from '../../../shared/errors/http-status';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import {
  decideCancellation,
  isCancellationWithinPolicy,
  resolveCancellationNoticeMinutes,
} from '../domain/cancellation-policy';
import {
  BOOKING_REPOSITORY,
  type BookingListScope,
  type BookingRepository,
  type BookingView,
  type CreateBookingCommand,
  type CreateBookingOutcome,
  type DayAgenda,
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

/** El personal solo ve su propia agenda aunque pida otra; administración ve todas o filtra por persona. */
@Injectable()
export class GetDayAgendaUseCase {
  constructor(@Inject(BOOKING_REPOSITORY) private readonly bookings: BookingRepository) {}

  async execute(request: DayAgendaRequest): Promise<DayAgenda> {
    const { actor, date, requestedStaffMembershipId } = request;
    const staffMembershipId =
      actor.role === 'staff' ? actor.membershipId : requestedStaffMembershipId;
    return this.bookings.listDayAgenda(actor, { date, staffMembershipId });
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
