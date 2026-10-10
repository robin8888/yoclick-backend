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
  /** Sala donde se da; `null` si la cita no tiene sala. */
  readonly room: { readonly id: string; readonly name: string } | null;
  /** La sesión que ocupa: privada (una persona) o grupal (varias hasta el aforo). */
  readonly session: {
    readonly id: string;
    readonly mode: 'private' | 'group';
    readonly capacity: number;
    /** Plazas ya ocupadas (reservas no canceladas). */
    readonly bookedCount: number;
  };
  readonly cancelledAt: Date | null;
  readonly cancelWithinPolicy: boolean | null;
  readonly startedAt: Date | null;
  readonly endedAt: Date | null;
  readonly createdAt: Date;
  /** Quién asignó la cita; `null` en las anteriores a este dato. */
  readonly createdBy: {
    readonly membershipId: string;
    readonly fullName: string;
    readonly role: 'owner' | 'admin' | 'staff' | 'client';
  } | null;
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
  /** Privada (por defecto) o grupal: la grupal abre una sesión con el aforo de la sala. */
  readonly mode?: 'private' | 'group' | undefined;
  /** Sala elegida; sin ella se busca una libre de quien da la clase (si el centro tiene salas). */
  readonly roomId?: string | null | undefined;
  /** Sala que se prefiere si está libre (p. ej. la que ya tenía la cita al moverla). */
  readonly preferredRoomId?: string | null | undefined;
}

export interface JoinGroupSessionCommand {
  readonly classSessionId: string;
  readonly clientMembershipId: string;
  readonly now: Date;
}

export type CreateBookingOutcome =
  | { readonly kind: 'created'; readonly booking: BookingView }
  | { readonly kind: 'service_not_found' }
  /** El cliente indicado no es un cliente activo de este centro. */
  | { readonly kind: 'client_not_found' }
  | { readonly kind: 'outside_window' }
  | { readonly kind: 'slot_unavailable' }
  | { readonly kind: 'already_booked' }
  /** La sala no existe, está ocupada a esa hora o no la da esa persona. */
  | { readonly kind: 'room_unavailable' };

export type JoinGroupSessionOutcome =
  | { readonly kind: 'created'; readonly booking: BookingView }
  | { readonly kind: 'client_not_found' }
  /** La sesión no existe, no es grupal, está cancelada o ya empezó. */
  | { readonly kind: 'session_not_found' }
  | { readonly kind: 'session_full' }
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
  | { readonly kind: 'client_not_found' }
  | { readonly kind: 'room_unavailable' };

export type BookingListScope = 'upcoming' | 'past';

export interface CancellationFacts {
  readonly booking: BookingView;
  readonly serviceCancelNoticeMinutes: number | null;
  /** `null` si el centro no tiene política de cancelación. */
  readonly centerFreeCancellationHours: number | null;
}

export interface PlacementOptionsQuery {
  readonly serviceId: string;
  readonly staffMembershipId: string;
  readonly date: string;
  readonly now: Date;
  /** Rejilla de inicios (cada cuántos minutos puede empezar una cita). */
  readonly stepMinutes: number;
}

export interface PlacementRoom {
  readonly id: string;
  readonly name: string;
  readonly capacity: number;
}

export interface PlacementOptions {
  readonly timeZone: string;
  /** Si esa persona tiene salas que usar; sin ellas la cita no lleva sala ni puede ser grupal. */
  readonly hasUsableRooms: boolean;
  /** Horas en las que la persona está libre, con las salas libres que puede usar a esa hora. */
  readonly openSlots: readonly {
    readonly startsAt: Date;
    readonly endsAt: Date;
    readonly freeRooms: readonly PlacementRoom[];
  }[];
  /** Clases grupales de esa persona ese día a las que todavía se puede apuntar a alguien. */
  readonly groupSessions: readonly {
    readonly sessionId: string;
    readonly startsAt: Date;
    readonly endsAt: Date;
    readonly serviceName: string;
    readonly room: { readonly id: string; readonly name: string };
    readonly capacity: number;
    readonly bookedCount: number;
  }[];
}

export interface GroupOptionsQuery {
  readonly serviceId: string;
  readonly date: string;
  readonly now: Date;
  readonly stepMinutes: number;
}

/** Una sala con profesor: sus horas libres y los grupos suyos de ese día con plazas. */
export interface GroupRoomOptions {
  readonly room: {
    readonly id: string;
    readonly name: string;
    readonly capacity: number;
    readonly staff: { readonly membershipId: string; readonly fullName: string };
  };
  readonly openSlots: readonly { readonly startsAt: Date; readonly endsAt: Date }[];
  readonly groupSessions: PlacementOptions['groupSessions'];
}

export interface GroupOptions {
  readonly timeZone: string;
  readonly rooms: readonly GroupRoomOptions[];
}

/** Una clase que ocupa una sala (o una cita sin sala), con quienes están apuntados. */
export interface RoomSessionView {
  readonly id: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly mode: 'private' | 'group';
  readonly capacity: number;
  readonly bookedCount: number;
  readonly service: { readonly id: string; readonly name: string; readonly color: string | null };
  readonly teacher: { readonly membershipId: string; readonly fullName: string };
  readonly attendees: readonly {
    readonly bookingId: string;
    readonly clientMembershipId: string;
    readonly fullName: string;
    readonly status: BookingStatusName;
  }[];
}

export interface RoomDayView {
  readonly id: string;
  readonly name: string;
  readonly capacity: number;
  /** Profesor fijo de la sala; `null` si la usa cualquiera. */
  readonly staff: { readonly membershipId: string; readonly fullName: string } | null;
  readonly sessions: readonly RoomSessionView[];
}

export interface RoomAgenda {
  readonly timeZone: string;
  /** Cuándo abre el centro ese día (hora local): las filas de la línea temporal. */
  readonly openingRanges: readonly { readonly opensAt: string; readonly closesAt: string }[];
  readonly rooms: readonly RoomDayView[];
  /** Citas de ese día que no tienen sala (anteriores a las salas o de centros sin ellas). */
  readonly sessionsWithoutRoom: readonly RoomSessionView[];
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
  /**
   * Apunta a un cliente a una clase grupal que ya existe, si quedan plazas. El recuento de plazas
   * y la reserva se hacen bajo un bloqueo de la sesión: nadie se pasa del aforo.
   */
  joinGroupSession(
    actor: ActorContext,
    command: JoinGroupSessionCommand,
  ): Promise<JoinGroupSessionOutcome>;
  /** Qué horas libres tiene una persona del equipo ese día (con las salas libres) y qué grupos puede completar. */
  listPlacementOptions(
    actor: ActorContext,
    query: PlacementOptionsQuery,
  ): Promise<PlacementOptions | null>;
  /**
   * Para una cita grupal: cada sala con profesor que da el servicio, con sus horas libres ese día
   * (profesor y sala libres) y sus grupos con plazas. `null` si el servicio no existe.
   */
  listGroupOptions(actor: ActorContext, query: GroupOptionsQuery): Promise<GroupOptions | null>;
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
  /** La agenda del día por sala: cuándo está ocupada cada una, con su aforo, profesor y alumnos. */
  listRoomAgenda(actor: ActorContext, query: { date: string }): Promise<RoomAgenda>;
}

export const BOOKING_REPOSITORY = Symbol('BOOKING_REPOSITORY');
