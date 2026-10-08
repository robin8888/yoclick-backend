import { Module } from '@nestjs/common';
import { ROUTINE_REPOSITORY } from './application/ports/routine.repository';
import {
  ArchiveRoutineUseCase,
  AssignRoutineUseCase,
  CreateRoutineUseCase,
  UpdateRoutineUseCase,
  GetExerciseLibraryUseCase,
  GetRoutineUseCase,
  ListMyRoutinesUseCase,
  ListRoutinesUseCase,
  UnassignRoutineUseCase,
} from './application/routine.use-cases';
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
    RoutineAssignmentsController,
  ],
  providers: [
    GetExerciseLibraryUseCase,
    CreateRoutineUseCase,
    UpdateRoutineUseCase,
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
