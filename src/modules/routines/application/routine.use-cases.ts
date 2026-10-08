import { Inject, Injectable } from '@nestjs/common';
import { v7 as generateUuidV7 } from 'uuid';
import { DomainError } from '../../../shared/errors/domain-error';
import { HTTP_STATUS } from '../../../shared/errors/http-status';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { getExerciseLibrary, type LibraryExercise } from '../domain/exercise-library';
import { type AssignmentTarget, type RoutineItemInput } from '../domain/routine-rules';
import {
  ROUTINE_REPOSITORY,
  type ClientRoutineView,
  type RoutineChanges,
  type RoutineDetail,
  type RoutineRepository,
  type RoutineSummary,
} from './ports/routine.repository';

@Injectable()
export class GetExerciseLibraryUseCase {
  constructor(@Inject(ROUTINE_REPOSITORY) private readonly routines: RoutineRepository) {}

  async execute(actor: ActorContext): Promise<readonly LibraryExercise[]> {
    return getExerciseLibrary(await this.routines.findCenterSectorId(actor));
  }
}

export interface CreateRoutineRequest {
  readonly actor: ActorContext;
  readonly name: string;
  readonly note: string | null;
  readonly items: readonly RoutineItemInput[];
  readonly assignTo: AssignmentTarget | null;
}

@Injectable()
export class CreateRoutineUseCase {
  constructor(@Inject(ROUTINE_REPOSITORY) private readonly routines: RoutineRepository) {}

  async execute(request: CreateRoutineRequest): Promise<RoutineDetail> {
    const outcome = await this.routines.create(request.actor, {
      id: generateUuidV7(),
      name: request.name,
      note: request.note,
      items: request.items,
      assignTo: request.assignTo,
    });
    if (outcome.kind !== 'created') throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
    return outcome.routine;
  }
}

@Injectable()
export class UpdateRoutineUseCase {
  constructor(@Inject(ROUTINE_REPOSITORY) private readonly routines: RoutineRepository) {}

  async execute(
    actor: ActorContext,
    routineId: string,
    changes: RoutineChanges,
  ): Promise<RoutineDetail> {
    const outcome = await this.routines.update(actor, routineId, changes);
    if (outcome.kind !== 'updated') throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
    return outcome.routine;
  }
}

@Injectable()
export class ListRoutinesUseCase {
  constructor(@Inject(ROUTINE_REPOSITORY) private readonly routines: RoutineRepository) {}

  async execute(actor: ActorContext): Promise<RoutineSummary[]> {
    return this.routines.list(actor);
  }
}

@Injectable()
export class GetRoutineUseCase {
  constructor(@Inject(ROUTINE_REPOSITORY) private readonly routines: RoutineRepository) {}

  async execute(actor: ActorContext, routineId: string): Promise<RoutineDetail> {
    const routine = await this.routines.find(actor, routineId);
    if (!routine) throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
    return routine;
  }
}

@Injectable()
export class ArchiveRoutineUseCase {
  constructor(@Inject(ROUTINE_REPOSITORY) private readonly routines: RoutineRepository) {}

  async execute(actor: ActorContext, routineId: string): Promise<void> {
    if (!(await this.routines.archive(actor, routineId))) {
      throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
    }
  }
}

const ASSIGNMENT_REFUSALS = {
  not_found: ['NOT_FOUND', HTTP_STATUS.notFound],
  unknown_target: ['NOT_FOUND', HTTP_STATUS.notFound],
  already_assigned: ['CONFLICT', HTTP_STATUS.conflict],
} as const;

@Injectable()
export class AssignRoutineUseCase {
  constructor(@Inject(ROUTINE_REPOSITORY) private readonly routines: RoutineRepository) {}

  async execute(request: {
    actor: ActorContext;
    routineId: string;
    target: AssignmentTarget;
  }): Promise<RoutineDetail> {
    const outcome = await this.routines.assign(request.actor, {
      routineId: request.routineId,
      assignmentId: generateUuidV7(),
      target: request.target,
    });
    if (outcome.kind !== 'assigned') {
      const [code, httpStatus] = ASSIGNMENT_REFUSALS[outcome.kind];
      throw new DomainError(code, httpStatus);
    }
    return new GetRoutineUseCase(this.routines).execute(request.actor, request.routineId);
  }
}

@Injectable()
export class UnassignRoutineUseCase {
  constructor(@Inject(ROUTINE_REPOSITORY) private readonly routines: RoutineRepository) {}

  async execute(actor: ActorContext, routineId: string, assignmentId: string): Promise<void> {
    if (!(await this.routines.unassign(actor, routineId, assignmentId))) {
      throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
    }
  }
}

@Injectable()
export class ListMyRoutinesUseCase {
  constructor(@Inject(ROUTINE_REPOSITORY) private readonly routines: RoutineRepository) {}

  async execute(actor: ActorContext): Promise<ClientRoutineView[]> {
    return this.routines.listForClient(actor);
  }
}
