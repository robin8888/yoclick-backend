import { type ActorContext } from '../../../../shared/tenancy/actor-context';
import { type AssignmentTarget, type RoutineItemInput } from '../../domain/routine-rules';

export interface RoutineSummary {
  readonly id: string;
  readonly name: string;
  readonly itemCount: number;
  readonly assignmentCount: number;
  readonly createdAt: Date;
}

export interface RoutineAssignmentView {
  readonly id: string;
  readonly kind: 'client' | 'group';
  /** Nombre de la persona o del grupo. */
  readonly targetName: string;
  readonly assignedAt: Date;
}

export interface RoutineDetail {
  readonly id: string;
  readonly name: string;
  readonly note: string | null;
  readonly items: readonly RoutineItemInput[];
  readonly assignments: readonly RoutineAssignmentView[];
  readonly createdAt: Date;
}

export interface NewRoutine {
  readonly id: string;
  readonly name: string;
  readonly note: string | null;
  readonly items: readonly RoutineItemInput[];
  /** Si se indica, la rutina se asigna al crearla. */
  readonly assignTo: AssignmentTarget | null;
}

/** Lo que ve quien recibe una rutina. */
export interface ClientRoutineView {
  readonly id: string;
  readonly name: string;
  readonly note: string | null;
  readonly items: readonly RoutineItemInput[];
  /** La asignación más reciente que le llega (directa o por su grupo). */
  readonly assignedAt: Date;
}

export type CreateRoutineOutcome =
  | { readonly kind: 'created'; readonly routine: RoutineDetail }
  /** La persona o el grupo no existen en este centro, o no son clientes ni grupos activos. */
  | { readonly kind: 'unknown_target' };

export type AssignRoutineOutcome =
  | { readonly kind: 'assigned'; readonly assignmentId: string }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'unknown_target' }
  | { readonly kind: 'already_assigned' };

export interface RoutineRepository {
  create(actor: ActorContext, routine: NewRoutine): Promise<CreateRoutineOutcome>;
  list(actor: ActorContext): Promise<RoutineSummary[]>;
  find(actor: ActorContext, routineId: string): Promise<RoutineDetail | null>;
  /** `false` si no existe o ya estaba archivada. */
  archive(actor: ActorContext, routineId: string): Promise<boolean>;
  assign(
    actor: ActorContext,
    request: { routineId: string; assignmentId: string; target: AssignmentTarget },
  ): Promise<AssignRoutineOutcome>;
  unassign(actor: ActorContext, routineId: string, assignmentId: string): Promise<boolean>;
  /** Las rutinas asignadas a esa persona, directamente o por su grupo, de la más reciente a la más antigua. */
  listForClient(actor: ActorContext): Promise<ClientRoutineView[]>;
}

export const ROUTINE_REPOSITORY = Symbol('ROUTINE_REPOSITORY');
