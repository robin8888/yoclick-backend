import { type ActorContext } from '../../../../shared/tenancy/actor-context';
import { type TimeEntryViolation } from '../../domain/time-entry-rules';

export type TimeEntrySourceName = 'qr' | 'manual';

/** Un turno de trabajo tal y como lo ve la app. */
export interface TimeEntryView {
  readonly id: string;
  readonly staffMembershipId: string;
  /** Fecha local del centro (`YYYY-MM-DD`) en la que empieza el turno. */
  readonly workDate: string;
  readonly clockInAt: Date;
  readonly clockOutAt: Date | null;
  readonly isOpen: boolean;
  /** Minutos completos del turno; 0 mientras siga abierto. */
  readonly workedMinutes: number;
  readonly inSource: TimeEntrySourceName;
  readonly outSource: TimeEntrySourceName | null;
  readonly isEdited: boolean;
  readonly originalClockInAt: Date | null;
  readonly originalClockOutAt: Date | null;
  readonly editedAt: Date | null;
}

export interface TeamClockScan {
  readonly staffMembershipId: string;
  readonly fullName: string;
  readonly action: 'clock_in' | 'clock_out';
  readonly occurredAt: Date;
  /** Solo en la salida: minutos del turno que se cierra. */
  readonly workedMinutes: number | null;
  readonly entry: TimeEntryView;
}

export type TeamClockScanOutcome =
  | { readonly kind: 'recorded'; readonly scan: TeamClockScan }
  /** La membresía del código no es del equipo activo de este centro (puede ser una clienta). */
  | { readonly kind: 'not_team_member' };

export type TimeEntryChangeOutcome =
  | { readonly kind: 'saved'; readonly entry: TimeEntryView }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'overlap' }
  | { readonly kind: 'violation'; readonly violation: TimeEntryViolation };

export interface NewTimeEntry {
  readonly staffMembershipId: string;
  readonly clockInAt: Date;
  readonly clockOutAt: Date;
  readonly now: Date;
}

export interface TimeEntryPatch {
  readonly entryId: string;
  readonly clockInAt?: Date | undefined;
  readonly clockOutAt?: Date | undefined;
  readonly now: Date;
}

export interface TimeEntryRepository {
  /** Ficha a la persona del equipo del código: entrada o salida según tenga un turno abierto. */
  recordTeamScan(
    actor: ActorContext,
    command: { scannedMembershipId: string; now: Date },
  ): Promise<TeamClockScanOutcome>;
  /** Entradas no borradas de la persona cuya fecha de trabajo cae en el mes (`YYYY-MM`). */
  listForMonth(
    actor: ActorContext,
    query: { staffMembershipId: string; month: string },
  ): Promise<readonly TimeEntryView[]>;
  create(actor: ActorContext, newEntry: NewTimeEntry): Promise<TimeEntryChangeOutcome>;
  update(actor: ActorContext, patch: TimeEntryPatch): Promise<TimeEntryChangeOutcome>;
  /** `false` si no existe o no es suya. */
  softDelete(actor: ActorContext, command: { entryId: string; now: Date }): Promise<boolean>;
}

export const TIME_ENTRY_REPOSITORY = Symbol('TIME_ENTRY_REPOSITORY');
