import { type ActorContext } from '../../../../shared/tenancy/actor-context';
import { type OpeningHours } from '../../../centers/domain/opening-hours';

export type AbsenceReasonName = 'vacation' | 'training' | 'personal' | 'other';

export interface AbsenceView {
  readonly id: string;
  /** `YYYY-MM-DD`, ambos extremos incluidos. */
  readonly startsOn: string;
  readonly endsOn: string;
  readonly reason: AbsenceReasonName;
}

export interface StaffAvailabilityView {
  /** `null`: no tiene horario propio y sigue el del centro. */
  readonly weeklyHours: OpeningHours | null;
  readonly absences: readonly AbsenceView[];
}

export interface NewAbsence extends AbsenceView {
  readonly membershipId: string;
}

export interface StaffAvailabilityRepository {
  /** `null` si la persona no existe en este centro o no es del equipo. */
  findAvailability(
    actor: ActorContext,
    membershipId: string,
  ): Promise<StaffAvailabilityView | null>;
  saveWeeklyHours(
    actor: ActorContext,
    membershipId: string,
    weeklyHours: OpeningHours | null,
  ): Promise<void>;
  /** Devuelve cuántas citas no canceladas de esa persona caen en las fechas de la ausencia. */
  addAbsence(actor: ActorContext, absence: NewAbsence): Promise<{ affectedBookingCount: number }>;
  removeAbsence(actor: ActorContext, membershipId: string, absenceId: string): Promise<boolean>;
}

export const STAFF_AVAILABILITY_REPOSITORY = Symbol('STAFF_AVAILABILITY_REPOSITORY');
