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
  /** Cuándo se confirmó que la persona vino (QR o check del profesional); `null` si aún no. */
  readonly checkedInAt: Date | null;
  /** Cita suelta o plaza de un grupo fijo (matrícula, no gasta bono). */
  readonly source: 'single' | 'enrollment';
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
  /**
   * Quien se apunta es el propio cliente: se respetan la antelación mínima y la ventana de reserva
   * del servicio, y que esté visible. El centro, al asignar, no las necesita.
   */
  readonly isClientBooking?: boolean | undefined;
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
  | { readonly kind: 'room_unavailable' }
  /** El servicio no se da en ese modo (solo privado o solo en grupo). */
  | { readonly kind: 'mode_not_allowed' }
  /** El servicio tiene horario de sala: solo se puede reservar en sus clases, no en una hora libre. */
  | { readonly kind: 'service_scheduled_only' };

export type JoinGroupSessionOutcome =
  | { readonly kind: 'created'; readonly booking: BookingView }
  | { readonly kind: 'client_not_found' }
  /** La sesión no existe, no es grupal, está cancelada o ya empezó. */
  | { readonly kind: 'session_not_found' }
  | { readonly kind: 'session_full' }
  | { readonly kind: 'already_booked' }
  /** El propio cliente pide una clase demasiado pronto o demasiado lejos, o de un servicio oculto. */
  | { readonly kind: 'outside_window' }
  /** Ya tiene agendadas todas las clases que le quedan en su bono. */
  | { readonly kind: 'pass_fully_booked' }
  /** El centro intenta apuntar a alguien sin bono en vigor con clases. */
  | { readonly kind: 'client_has_no_pass' };

export interface RescheduleBookingCommand {
  readonly bookingId: string;
  readonly startsAt: Date;
  readonly now: Date;
  /** Persona del equipo preferida para la hora nueva; sin ella, la misma que tenía la cita. */
  readonly preferredStaffMembershipId?: string | undefined;
  /** Rejilla de inicios más fina cuando mueve la cita el equipo (p. ej. cada 15 minutos). */
  readonly slotStepMinutes?: number | undefined;
}

export interface MoveToSessionCommand {
  readonly bookingId: string;
  /** La clase con plazas a la que pasa la reserva (de `GET /services/:id/open-sessions`). */
  readonly classSessionId: string;
  readonly now: Date;
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
  | { readonly kind: 'room_unavailable' }
  | { readonly kind: 'mode_not_allowed' }
  /** La clase a la que se pasa ya no tiene plazas. */
  | { readonly kind: 'session_full' };

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

export interface ServiceSessionsQuery {
  readonly serviceId: string;
  readonly fromDate: string;
  readonly toDate: string;
  readonly now: Date;
}

/** Una clase de un servicio a la que aún se puede apuntar a alguien. */
export interface ServiceSessionView {
  readonly id: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly mode: 'private' | 'group';
  readonly capacity: number;
  readonly bookedCount: number;
  readonly remainingSeats: number;
  readonly room: { readonly id: string; readonly name: string } | null;
  readonly teacher: { readonly membershipId: string; readonly fullName: string };
  /** El nombre del horario del que nació («Grupo especial»), si lo tiene. */
  readonly label: string | null;
}

export interface ServiceSessionsView {
  readonly timeZone: string;
  /** El servicio tiene horario de sala vigente: solo se reserva en sus clases. */
  readonly isScheduled: boolean;
  readonly sessions: readonly ServiceSessionView[];
  /** La próxima clase con plazas, aunque quede fuera del rango pedido. */
  readonly nextOpenStartsAt: Date | null;
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
  /** Horario del que nació la sesión (con su etiqueta); `null` si se creó al dar una cita. */
  readonly schedule: { readonly seriesId: string; readonly label: string | null } | null;
  /** Cancelada por el centro ese día (festivo, profesor enfermo…) y por qué; `null` si sigue en pie. */
  readonly cancelledReason: string | null;
  readonly attendees: readonly {
    readonly bookingId: string;
    readonly clientMembershipId: string;
    readonly fullName: string;
    /** Ruta de la foto en el almacén; la API la convierte en enlace firmado antes de responder. */
    readonly photoKey: string | null;
    readonly status: BookingStatusName;
    /** Plaza de grupo fijo (matrícula) o cita suelta. */
    readonly source: 'single' | 'enrollment';
  }[];
}

/** Un tramo en que la sala no está disponible: alquiler, mantenimiento, evento. */
export interface RoomBlockSummary {
  readonly id: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly reason: 'rental' | 'maintenance' | 'event' | 'other';
  readonly note: string | null;
}

export interface RoomDayView {
  readonly id: string;
  readonly name: string;
  readonly capacity: number;
  /** Profesor fijo de la sala; `null` si la usa cualquiera. */
  readonly staff: { readonly membershipId: string; readonly fullName: string } | null;
  readonly sessions: readonly RoomSessionView[];
  readonly blocks: readonly RoomBlockSummary[];
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
  readonly client: {
    readonly membershipId: string;
    readonly fullName: string;
    /** Ruta de su foto en el almacén; la API la convierte en un enlace firmado. */
    readonly photoKey: string | null;
  };
}

/** Una clase del horario a la que aún no se ha apuntado nadie: existe, pero no tiene reservas. */
export interface EmptySessionView {
  readonly id: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly mode: 'private' | 'group';
  readonly capacity: number;
  readonly service: { readonly id: string; readonly name: string };
  readonly room: { readonly id: string; readonly name: string } | null;
  readonly staff: { readonly membershipId: string; readonly fullName: string };
}

export interface DayAgenda {
  readonly timeZone: string;
  /** Cuándo abre el centro ese día (hora local): el profesional ve de un vistazo sus huecos. */
  readonly openingRanges: readonly { readonly opensAt: string; readonly closesAt: string }[];
  readonly entries: readonly AgendaEntryView[];
  /** Las clases del día sin nadie apuntado, para que el profesional vea que existen. */
  readonly emptySessions: readonly EmptySessionView[];
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
  /** El cliente pasa su reserva a otra clase con plazas del mismo servicio. */
  moveToSession(actor: ActorContext, command: MoveToSessionCommand): Promise<RescheduleOutcome>;
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
  listServiceSessions(
    actor: ActorContext,
    query: ServiceSessionsQuery,
  ): Promise<ServiceSessionsView | null>;
}

export const BOOKING_REPOSITORY = Symbol('BOOKING_REPOSITORY');
