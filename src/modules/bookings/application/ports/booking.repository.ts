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

export interface RescheduleBookingCommand {
  readonly bookingId: string;
  readonly startsAt: Date;
  readonly now: Date;
  /** Persona del equipo preferida para la hora nueva; sin ella, la misma que tenía la cita. */
  readonly preferredStaffMembershipId?: string | undefined;
  /** Rejilla de inicios más fina cuando mueve la cita el equipo (p. ej. cada 15 minutos). */
  readonly slotStepMinutes?: number | undefined;
}

export type RescheduleOutcome =
  | {
      readonly kind: 'rescheduled';
      readonly booking: BookingView;
      /** `false` si pidió la hora que ya tenía: no se avisa a nadie. */
      readonly hasChangedTime: boolean;
    }
  /** No existe, o es de otra persona. */
  | { readonly kind: 'not_found' }
  /** Ya cancelada, empezada, atendida o pasada. */
  | { readonly kind: 'not_reschedulable' }
  /** Queda menos antelación de la que exige la política de cancelación. */
  | { readonly kind: 'too_late' }
  | { readonly kind: 'outside_window' }
  | { readonly kind: 'slot_unavailable' }
  | { readonly kind: 'already_booked' }
  | { readonly kind: 'service_not_found' }
  | { readonly kind: 'client_not_found' };

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

export type TeamCancellationOutcome =
  | { readonly kind: 'cancelled'; readonly booking: BookingView }
  /** No existe, o es de otra persona del equipo y quien pregunta es personal. */
  | { readonly kind: 'not_found' }
  /** Ya estaba cancelada, ya empezó o ya pasó. */
  | { readonly kind: 'not_cancellable' };

export interface BookingRepository {
  /**
   * Reserva en una sola transacción: recalcula el hueco, comprueba que el cliente no tiene otra
   * cita a esa hora y crea la sesión y la reserva. Nunca deja dos reservas confirmadas en el mismo
   * hueco de la misma persona del equipo, por muchas peticiones que lleguen a la vez.
   */
  createBooking(actor: ActorContext, command: CreateBookingCommand): Promise<CreateBookingOutcome>;
  /** Mueve una reserva del propio cliente a otra hora en una sola transacción. */
  rescheduleBooking(
    actor: ActorContext,
    command: RescheduleBookingCommand,
  ): Promise<RescheduleOutcome>;
  /**
   * Mueve una reserva a otra hora desde la agenda del centro. La administración mueve cualquiera; el
   * personal, solo las de sus sesiones. No exige antelación y avisa al cliente.
   */
  rescheduleByTeam(
    actor: ActorContext,
    command: RescheduleBookingCommand,
  ): Promise<RescheduleOutcome>;
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
  /**
   * Cancela una reserva futura desde la agenda del centro. La administración cancela cualquiera; el
   * personal, solo las de sus propias sesiones. Deja un aviso al cliente y al equipo.
   */
  cancelByTeam(
    actor: ActorContext,
    request: { bookingId: string; now: Date },
  ): Promise<TeamCancellationOutcome>;
  listDayAgenda(
    actor: ActorContext,
    query: { date: string; staffMembershipId: string | null },
  ): Promise<DayAgenda>;
}

export const BOOKING_REPOSITORY = Symbol('BOOKING_REPOSITORY');
