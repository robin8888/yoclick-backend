import { Module } from '@nestjs/common';
import { SCHEDULE_REPOSITORY } from './application/ports/schedule.repository';
import {
  CancelSessionDayUseCase,
  CreateRoomBlockUseCase,
  CreateScheduleSeriesUseCase,
  DeleteRoomBlockUseCase,
  ListMyRentalsUseCase,
  EndScheduleSeriesUseCase,
  EnrollClientsUseCase,
  ListEnrollmentsUseCase,
  ListRoomBlocksUseCase,
  ListScheduleSeriesUseCase,
  RepeatWeekUseCase,
  UnenrollClientUseCase,
  UpdateScheduleSeriesUseCase,
} from './application/schedule.use-cases';
import { EnrollmentsController } from './http/enrollments.controller';
import { RoomBlocksController } from './http/room-blocks.controller';
import { ScheduleRepeatController } from './http/schedule-repeat.controller';
import { SchedulesController } from './http/schedules.controller';
import { SessionCancellationController } from './http/session-cancellation.controller';
import { PrismaScheduleRepository } from './infrastructure/prisma-schedule.repository';

/** Horarios de sala, grupos fijos y bloqueos (docs/spec/09 de la app). */
@Module({
  controllers: [
    ScheduleRepeatController,
    SchedulesController,
    EnrollmentsController,
    SessionCancellationController,
    RoomBlocksController,
  ],
  providers: [
    ListScheduleSeriesUseCase,
    CreateScheduleSeriesUseCase,
    RepeatWeekUseCase,
    UpdateScheduleSeriesUseCase,
    EndScheduleSeriesUseCase,
    ListEnrollmentsUseCase,
    EnrollClientsUseCase,
    UnenrollClientUseCase,
    CancelSessionDayUseCase,
    ListRoomBlocksUseCase,
    CreateRoomBlockUseCase,
    DeleteRoomBlockUseCase,
    ListMyRentalsUseCase,
    { provide: SCHEDULE_REPOSITORY, useClass: PrismaScheduleRepository },
  ],
})
export class SchedulesModule {}
