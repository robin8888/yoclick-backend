import { Module } from '@nestjs/common';
import { IdempotencyModule } from '../../shared/idempotency/idempotency.module';
import {
  CancelBookingUseCase,
  CancelBookingByTeamUseCase,
  CreateBookingUseCase,
  GetDayAgendaUseCase,
  GetGroupOptionsUseCase,
  GetPlacementOptionsUseCase,
  GetRoomAgendaUseCase,
  JoinGroupSessionUseCase,
  ListServiceSessionsUseCase,
  MoveBookingToSessionUseCase,
  ListMyBookingsUseCase,
  RescheduleBookingByTeamUseCase,
  RescheduleBookingUseCase,
} from './application/booking.use-cases';
import { AgendaReschedulingController } from './http/agenda-rescheduling.controller';
import { BookingReschedulingController } from './http/booking-rescheduling.controller';
import { CheckInClientUseCase, IssueCheckInCodeUseCase } from './application/check-in.use-cases';
import { CHECK_IN_REPOSITORY } from './application/ports/check-in.repository';
import { BOOKING_REPOSITORY } from './application/ports/booking.repository';
import { SESSION_RECORD_REPOSITORY } from './application/ports/session-record.repository';
import {
  ConfirmAttendanceUseCase,
  EndSessionUseCase,
  ListSessionRecordsUseCase,
  StartSessionUseCase,
} from './application/session-record.use-cases';
import { AgendaController } from './http/agenda.controller';
import { AgendaPlacementController } from './http/agenda-placement.controller';
import { AgendaRoomsController } from './http/agenda-rooms.controller';
import { BookingSessionsController } from './http/booking-sessions.controller';
import { CheckInController } from './http/check-in.controller';
import { BookingsController } from './http/bookings.controller';
import { ClientSessionBookingsController } from './http/client-session-bookings.controller';
import { ServiceSessionsController } from './http/service-sessions.controller';
import { SessionRecordsController } from './http/session-records.controller';
import { PrismaCheckInRepository } from './infrastructure/prisma-check-in.repository';
import { PrismaBookingRepository } from './infrastructure/prisma-booking.repository';
import { PrismaSessionRecordRepository } from './infrastructure/prisma-session-record.repository';

@Module({
  imports: [IdempotencyModule],
  controllers: [
    BookingsController,
    ClientSessionBookingsController,
    BookingReschedulingController,
    BookingSessionsController,
    AgendaController,
    AgendaPlacementController,
    AgendaRoomsController,
    AgendaReschedulingController,
    ServiceSessionsController,
    SessionRecordsController,
    CheckInController,
  ],
  providers: [
    CreateBookingUseCase,
    ListMyBookingsUseCase,
    CancelBookingUseCase,
    RescheduleBookingUseCase,
    RescheduleBookingByTeamUseCase,
    CancelBookingByTeamUseCase,
    GetDayAgendaUseCase,
    GetGroupOptionsUseCase,
    GetPlacementOptionsUseCase,
    GetRoomAgendaUseCase,
    ListServiceSessionsUseCase,
    MoveBookingToSessionUseCase,
    JoinGroupSessionUseCase,
    StartSessionUseCase,
    EndSessionUseCase,
    ConfirmAttendanceUseCase,
    ListSessionRecordsUseCase,
    IssueCheckInCodeUseCase,
    CheckInClientUseCase,
    { provide: CHECK_IN_REPOSITORY, useClass: PrismaCheckInRepository },
    { provide: BOOKING_REPOSITORY, useClass: PrismaBookingRepository },
    { provide: SESSION_RECORD_REPOSITORY, useClass: PrismaSessionRecordRepository },
  ],
})
export class BookingsModule {}
