import { type ActorContext } from '../../../../shared/tenancy/actor-context';
import { type BookingStatusName } from '../../domain/cancellation-policy';

export interface BookingView {
  readonly id: string;
  readonly status: BookingStatusName;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly service: {
    readonly id: string;
    readonly name: string;
    readonly durationMinutes: number;
    readonly color: string | null;
  };
  readonly staff: { readonly membershipId: string; readonly fullName: string };
  readonly cancelledAt: Date | null;
  readonly cancelWithinPolicy: boolean | null;
  readonly createdAt: Date;
}

export interface CreateBookingCommand {
  readonly serviceId: string;
  readonly startsAt: Date;
  readonly preferredStaffMembershipId: string | null;
  readonly idempotencyKey: string;
  readonly now: Date;
}

export type CreateBookingOutcome =
  | { readonly kind: 'created'; readonly booking: BookingView }
  | { readonly kind: 'service_not_found' }
  | { readonly kind: 'outside_window' }
  | { readonly kind: 'slot_unavailable' }
  | { readonly kind: 'already_booked' };

export type BookingListScope = 'upcoming' | 'past';

export interface CancellationFacts {
  readonly booking: BookingView;
  readonly serviceCancelNoticeMinutes: number | null;
  /** `null` si el centro no tiene política de cancelación. */
  readonly centerFreeCancellationHours: number | null;
}

export interface AgendaEntryView {
  readonly booking: BookingView;
  readonly client: { readonly membershipId: string; readonly fullName: string };
}

export interface DayAgenda {
  readonly timeZone: string;
  readonly entries: readonly AgendaEntryView[];
}

export interface BookingRepository {
  /**
   * Reserva en una sola transacción: recalcula el hueco, comprueba que el cliente no tiene otra
   * cita a esa hora y crea la sesión y la reserva. Nunca deja dos reservas confirmadas en el mismo
   * hueco de la misma persona del equipo, por muchas peticiones que lleguen a la vez.
   */
  createBooking(actor: ActorContext, command: CreateBookingCommand): Promise<CreateBookingOutcome>;
  listClientBookings(
    actor: ActorContext,
    query: { scope: BookingListScope; limit: number; now: Date },
  ): Promise<BookingView[]>;
  /** Una reserva del propio cliente; `null` si no existe o es de otra persona. */
  findCancellationFacts(actor: ActorContext, bookingId: string): Promise<CancellationFacts | null>;
  /** Cancela solo si sigue confirmada; `null` si otra petición se adelantó. */
  markCancelled(
    actor: ActorContext,
    cancellation: { bookingId: string; cancelledAt: Date; isWithinPolicy: boolean },
  ): Promise<BookingView | null>;
  listDayAgenda(
    actor: ActorContext,
    query: { date: string; staffMembershipId: string | null },
  ): Promise<DayAgenda>;
}

export const BOOKING_REPOSITORY = Symbol('BOOKING_REPOSITORY');
