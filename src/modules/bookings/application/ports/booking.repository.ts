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
  readonly startedAt: Date | null;
  readonly endedAt: Date | null;
  readonly createdAt: Date;
}

export interface CreateBookingCommand {
  readonly serviceId: string;
  readonly startsAt: Date;
  readonly preferredStaffMembershipId: string | null;
  /** Clave de idempotencia del cliente; `null` si la reserva la hace la plantilla para un cliente. */
  readonly idempotencyKey: string | null;
  readonly now: Date;
  /** Para quién es la reserva cuando la hace el equipo; sin él, para quien la pide. */
  readonly clientMembershipId?: string | undefined;
  /** Rejilla de inicios más fina cuando pone la cita el equipo (p. ej. cada 15 minutos). */
  readonly slotStepMinutes?: number | undefined;
}

export type CreateBookingOutcome =
  | { readonly kind: 'created'; readonly booking: BookingView }
  | { readonly kind: 'service_not_found' }
  /** El cliente indicado no es un cliente activo de este centro. */
  | { readonly kind: 'client_not_found' }
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
  /** Cuándo abre el centro ese día (hora local): el profesional ve de un vistazo sus huecos. */
  readonly openingRanges: readonly { readonly opensAt: string; readonly closesAt: string }[];
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
