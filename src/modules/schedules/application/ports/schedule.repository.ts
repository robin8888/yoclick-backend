import { type ActorContext } from '../../../../shared/tenancy/actor-context';
import { type ScheduleWeekday, type SessionModeName } from '../../domain/schedule-rules';

export interface PersonRef {
  readonly membershipId: string;
  readonly fullName: string;
}

/** Un día de la semana de una serie: «lunes 18:00–19:30». */
export interface ScheduleDayView {
  readonly scheduleId: string;
  readonly weekday: ScheduleWeekday;
  readonly startsAtTime: string;
  readonly endsAtTime: string;
}

/** Un horario tal y como lo ve la app: la serie completa con sus días. */
export interface ScheduleSeriesView {
  readonly seriesId: string;
  readonly label: string | null;
  readonly mode: SessionModeName;
  readonly capacity: number;
  readonly status: 'active' | 'ended';
  readonly startsOn: string;
  readonly endsOn: string | null;
  readonly service: { readonly id: string; readonly name: string; readonly color: string | null };
  readonly staff: PersonRef;
  readonly room: { readonly id: string; readonly name: string } | null;
  readonly days: readonly ScheduleDayView[];
  /** Personas matriculadas (grupo fijo) ahora mismo. */
  readonly enrolledCount: number;
}

export type OccurrenceSkipReason = 'holiday' | 'absence' | 'conflict' | 'blocked';

/** Una fecha en la que el horario no pudo crear su sesión y por qué. */
export interface SkippedOccurrence {
  readonly date: string;
  readonly startsAtTime: string;
  readonly reason: OccurrenceSkipReason;
}

export interface NewScheduleSeries {
  readonly serviceId: string;
  /** Sin él se usa el profesor fijo de la sala. */
  readonly staffMembershipId: string | null;
  readonly roomId: string | null;
  readonly mode: SessionModeName;
  /** Tope de personas por sesión; sin él, el aforo de la sala. */
  readonly capacity: number | null;
  readonly weekdays: readonly ScheduleWeekday[];
  readonly startsAtTime: string;
  readonly endsAtTime: string;
  readonly startsOn: string;
  readonly endsOn: string | null;
  readonly label: string | null;
}

export type ScheduleSeriesCreationOutcome =
  | {
      readonly kind: 'created';
      readonly series: ScheduleSeriesView;
      readonly skipped: readonly SkippedOccurrence[];
    }
  | { readonly kind: 'service_not_found' }
  | { readonly kind: 'staff_not_found' }
  /** El servicio tiene profesores asignados y esa persona no es uno de ellos. */
  | { readonly kind: 'staff_not_for_service' }
  | { readonly kind: 'room_not_found' }
  /** Ni se indicó profesor ni la sala tiene uno fijo. */
  | { readonly kind: 'staff_required' }
  /** El modo pedido no lo admite el servicio, o la sala tiene otro servicio fijo. */
  | { readonly kind: 'mode_not_allowed' }
  | { readonly kind: 'room_not_for_service' }
  /** La sala ya tiene otro horario a esa hora en esos días y fechas. */
  | { readonly kind: 'room_schedule_overlap' }
  /** La misma persona ya da otra clase a esa hora en esos días y fechas. */
  | { readonly kind: 'teacher_schedule_overlap' }
  | { readonly kind: 'limit_reached' };

export interface ScheduleSeriesPatch {
  readonly label?: string | null | undefined;
  readonly capacity?: number | undefined;
  readonly endsOn?: string | null | undefined;
  readonly staffMembershipId?: string | undefined;
  readonly roomId?: string | null | undefined;
  readonly startsAtTime?: string | undefined;
  readonly endsAtTime?: string | undefined;
}

export type ScheduleSeriesUpdateOutcome =
  | {
      readonly kind: 'updated';
      readonly series: ScheduleSeriesView;
      readonly skipped: readonly SkippedOccurrence[];
    }
  | { readonly kind: 'not_found' }
  /** Hay sesiones futuras con citas sueltas: hay que cancelarlas antes de cambiar la hora, la sala o el profesor. */
  | { readonly kind: 'has_single_bookings'; readonly sessionCount: number }
  | { readonly kind: 'staff_not_found' }
  /** El servicio tiene profesores asignados y esa persona no es uno de ellos. */
  | { readonly kind: 'staff_not_for_service' }
  | { readonly kind: 'room_not_found' }
  | { readonly kind: 'room_not_for_service' }
  | { readonly kind: 'room_schedule_overlap' }
  | { readonly kind: 'teacher_schedule_overlap' };

export type EndSeriesOutcome =
  | {
      readonly kind: 'ended';
      /** Sesiones futuras que se conservan porque tienen citas sueltas. */
      readonly keptSessionCount: number;
    }
  | { readonly kind: 'not_found' };

export interface EnrollmentView {
  readonly id: string;
  readonly client: PersonRef;
  readonly startsOn: string;
  readonly endsOn: string | null;
  readonly status: 'active' | 'ended';
  readonly createdAt: Date;
}

export interface NewEnrollments {
  readonly seriesId: string;
  readonly clientMembershipIds: readonly string[];
  /** Sin ellas, las de la serie. */
  readonly startsOn: string | null;
  readonly endsOn: string | null;
}

export interface SkippedEnrollment {
  readonly clientMembershipId: string;
  readonly reason: 'client_not_found' | 'already_enrolled' | 'series_full';
}

/** Una sesión en la que una persona matriculada no pudo entrar porque ya tenía otra cita. */
export interface SkippedEnrollmentDate {
  readonly clientMembershipId: string;
  readonly date: string;
}

export type EnrollOutcome =
  | {
      readonly kind: 'enrolled';
      readonly enrollments: readonly EnrollmentView[];
      readonly skipped: readonly SkippedEnrollment[];
      readonly skippedDates: readonly SkippedEnrollmentDate[];
    }
  | { readonly kind: 'series_not_found' };

export type UnenrollOutcome =
  | { readonly kind: 'unenrolled'; readonly cancelledBookingCount: number }
  | { readonly kind: 'not_found' };

export interface SessionCancellation {
  readonly sessionId: string;
  readonly reason: string;
  readonly now: Date;
}

export type CancelSessionOutcome =
  | { readonly kind: 'cancelled'; readonly affectedBookingCount: number }
  | { readonly kind: 'not_found' }
  /** Ya cancelada o ya empezada. */
  | { readonly kind: 'not_cancellable' };

export type RoomBlockReasonName = 'rental' | 'maintenance' | 'event' | 'other';

export interface RoomBlockView {
  readonly id: string;
  readonly roomId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly reason: RoomBlockReasonName;
  readonly note: string | null;
  readonly createdBy: PersonRef;
}

export interface NewRoomBlock {
  readonly roomId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly reason: RoomBlockReasonName;
  readonly note: string | null;
}

export type RoomBlockCreationOutcome =
  | {
      readonly kind: 'created';
      readonly block: RoomBlockView;
      /** Sesiones de horario sin citas sueltas que se cancelaron para dejar la sala libre. */
      readonly cancelledSessionCount: number;
    }
  | { readonly kind: 'room_not_found' }
  /** Hay sesiones con citas en ese tramo: hay que cancelarlas o moverlas antes. */
  | { readonly kind: 'has_bookings'; readonly sessionCount: number }
  | { readonly kind: 'overlaps_block' };

export interface RepeatWeekOutcome {
  /** Horarios (series) copiados a la semana siguiente. */
  readonly copiedSeriesCount: number;
  /** Los que ya estaban copiados de antes: no se duplican. */
  readonly alreadyCopiedSeriesCount: number;
  /** Los que no se pudieron crear (límite de horarios, sala que ya no sirve…). */
  readonly failedSeriesCount: number;
  /** Fechas concretas que no se pudieron crear y por qué. */
  readonly skipped: readonly SkippedOccurrence[];
}

export interface ScheduleRepository {
  /** Las series del centro (activas primero) con sus días; de paso crea las sesiones que falten. */
  listSeries(actor: ActorContext, query: { now: Date }): Promise<ScheduleSeriesView[]>;
  createSeries(
    actor: ActorContext,
    newSeries: NewScheduleSeries,
    now: Date,
  ): Promise<ScheduleSeriesCreationOutcome>;
  /** Copia los horarios de una semana (lunes `weekStart`) a la siguiente. */
  repeatWeek(
    actor: ActorContext,
    request: { weekStart: string; now: Date },
  ): Promise<RepeatWeekOutcome>;
  updateSeries(
    actor: ActorContext,
    request: { seriesId: string; patch: ScheduleSeriesPatch; now: Date },
  ): Promise<ScheduleSeriesUpdateOutcome>;
  /** Termina la serie: cancela sus sesiones futuras sin citas sueltas y avisa a los matriculados. */
  endSeries(
    actor: ActorContext,
    request: { seriesId: string; now: Date },
  ): Promise<EndSeriesOutcome>;
  listEnrollments(actor: ActorContext, seriesId: string): Promise<EnrollmentView[] | null>;
  enroll(actor: ActorContext, request: NewEnrollments & { now: Date }): Promise<EnrollOutcome>;
  unenroll(
    actor: ActorContext,
    request: { seriesId: string; enrollmentId: string; now: Date },
  ): Promise<UnenrollOutcome>;
  /** Cancela un día: la sesión y todas sus citas, con aviso a cada persona. */
  cancelSession(
    actor: ActorContext,
    cancellation: SessionCancellation,
  ): Promise<CancelSessionOutcome>;
  listBlocks(
    actor: ActorContext,
    query: { roomId: string | null; from: Date; to: Date },
  ): Promise<RoomBlockView[]>;
  createBlock(actor: ActorContext, newBlock: NewRoomBlock): Promise<RoomBlockCreationOutcome>;
  /** `false` si el bloqueo no existe. */
  deleteBlock(actor: ActorContext, request: { roomId: string; blockId: string }): Promise<boolean>;
}

export const SCHEDULE_REPOSITORY = Symbol('SCHEDULE_REPOSITORY');
