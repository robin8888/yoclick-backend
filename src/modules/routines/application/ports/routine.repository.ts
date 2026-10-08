import { type ActorContext } from '../../../../shared/tenancy/actor-context';
import { type StoredVideo } from '../../../videos/application/ports/video.repository';
import { type AssignmentTarget, type RoutineItemInput } from '../../domain/routine-rules';

/** Un ejercicio tal como se muestra: con su vídeo, si lo tiene. */
export interface RoutineItemView {
  readonly name: string;
  readonly category: string | null;
  readonly prescription: string | null;
  readonly video: StoredVideo | null;
}

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
  readonly items: readonly RoutineItemView[];
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
  readonly items: readonly RoutineItemView[];
  /** La asignación más reciente que le llega (directa o por su grupo). */
  readonly assignedAt: Date;
}

export type CreateRoutineOutcome =
  | { readonly kind: 'created'; readonly routine: RoutineDetail }
  /** La persona o el grupo no existen en este centro, o no son clientes ni grupos activos. */
  | { readonly kind: 'unknown_target' }
  /** Algún vídeo de los ejercicios no existe en este centro. */
  | { readonly kind: 'unknown_video' };

export interface RoutineChanges {
  readonly name: string;
  readonly note: string | null;
  readonly items: readonly RoutineItemInput[];
}

export type UpdateRoutineOutcome =
  | { readonly kind: 'updated'; readonly routine: RoutineDetail }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'unknown_video' };

export type AssignRoutineOutcome =
  | { readonly kind: 'assigned'; readonly assignmentId: string }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'unknown_target' }
  | { readonly kind: 'already_assigned' };

export interface RoutineRepository {
  /** El tipo de centro (gym, yoga…): de él depende la biblioteca de ejercicios. */
  findCenterSectorId(actor: ActorContext): Promise<string>;
  create(actor: ActorContext, routine: NewRoutine): Promise<CreateRoutineOutcome>;
  list(actor: ActorContext): Promise<RoutineSummary[]>;
  find(actor: ActorContext, routineId: string): Promise<RoutineDetail | null>;
  /** Reemplaza el nombre, la nota y los ejercicios, y avisa a quien la tiene asignada. */
  update(
    actor: ActorContext,
    routineId: string,
    changes: RoutineChanges,
  ): Promise<UpdateRoutineOutcome>;
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
