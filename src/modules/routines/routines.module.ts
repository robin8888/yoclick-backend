import { Module } from '@nestjs/common';
import { ROUTINE_REPOSITORY } from './application/ports/routine.repository';
import {
  ArchiveRoutineUseCase,
  AssignRoutineUseCase,
  CreateRoutineUseCase,
  GetExerciseLibraryUseCase,
  GetRoutineUseCase,
  ListMyRoutinesUseCase,
  ListRoutinesUseCase,
  UnassignRoutineUseCase,
} from './application/routine.use-cases';
import {
  RoutineAssignmentsController,
  RoutineLibraryController,
  RoutinesController,
} from './http/routines.controller';
import { PrismaRoutineRepository } from './infrastructure/prisma-routine.repository';

@Module({
  controllers: [RoutineLibraryController, RoutinesController, RoutineAssignmentsController],
  providers: [
    GetExerciseLibraryUseCase,
    CreateRoutineUseCase,
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
