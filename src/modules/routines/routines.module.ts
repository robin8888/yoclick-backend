import { Module } from '@nestjs/common';
import { ROUTINE_REPOSITORY } from './application/ports/routine.repository';
import {
  ArchiveRoutineUseCase,
  AssignRoutineUseCase,
  CreateRoutineUseCase,
  UpdateRoutineUseCase,
  GetExerciseLibraryUseCase,
  GetRoutineProgressUseCase,
  GetRoutineUseCase,
  ListMyRoutinesUseCase,
  ListRoutinesUseCase,
  RecordRoutineCompletionUseCase,
  UnassignRoutineUseCase,
} from './application/routine.use-cases';
import { RoutineProgressController } from './http/routine-progress.controller';
import {
  RoutineAssignmentsController,
  RoutineLibraryController,
  RoutineEditingController,
  RoutinesController,
} from './http/routines.controller';
import { PrismaRoutineRepository } from './infrastructure/prisma-routine.repository';

@Module({
  controllers: [
    RoutineLibraryController,
    RoutinesController,
    RoutineEditingController,
    RoutineProgressController,
    RoutineAssignmentsController,
  ],
  providers: [
    GetExerciseLibraryUseCase,
    CreateRoutineUseCase,
    UpdateRoutineUseCase,
    RecordRoutineCompletionUseCase,
    GetRoutineProgressUseCase,
    ListRoutinesUseCase,
    GetRoutineUseCase,
    ArchiveRoutineUseCase,
    AssignRoutineUseCase,
    UnassignRoutineUseCase,
    ListMyRoutinesUseCase,
    { provide: ROUTINE_REPOSITORY, useClass: PrismaRoutineRepository },
  ],
})
export class RoutinesModule {}
