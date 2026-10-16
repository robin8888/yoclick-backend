import { Module } from '@nestjs/common';
import { SCHEDULE_REPOSITORY } from './application/ports/schedule.repository';
import {
  CancelSessionDayUseCase,
  CreateScheduleSeriesUseCase,
  EndScheduleSeriesUseCase,
  EnrollClientsUseCase,
  ListEnrollmentsUseCase,
  ListBusyTimesUseCase,
  ListScheduleSeriesUseCase,
  UnenrollClientUseCase,
  UpdateScheduleSeriesUseCase,
} from './application/schedule.use-cases';
import { EnrollmentsController } from './http/enrollments.controller';
import { BusyTimesController } from './http/busy-times.controller';
import { SchedulesController } from './http/schedules.controller';
import { SessionCancellationController } from './http/session-cancellation.controller';
import { PrismaScheduleRepository } from './infrastructure/prisma-schedule.repository';

/** Horarios de sala y grupos fijos (docs/spec/09 de la app). */
@Module({
  controllers: [
    BusyTimesController,
    SchedulesController,
    EnrollmentsController,
    SessionCancellationController,
  ],
  providers: [
    ListBusyTimesUseCase,
    ListScheduleSeriesUseCase,
    CreateScheduleSeriesUseCase,
    UpdateScheduleSeriesUseCase,
    EndScheduleSeriesUseCase,
    ListEnrollmentsUseCase,
    EnrollClientsUseCase,
    UnenrollClientUseCase,
    CancelSessionDayUseCase,
    { provide: SCHEDULE_REPOSITORY, useClass: PrismaScheduleRepository },
  ],
})
export class SchedulesModule {}
