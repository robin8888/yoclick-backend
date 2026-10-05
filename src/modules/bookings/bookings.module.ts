import { Module } from '@nestjs/common';
import { IdempotencyModule } from '../../shared/idempotency/idempotency.module';
import {
  CancelBookingUseCase,
  CreateBookingUseCase,
  GetDayAgendaUseCase,
  ListMyBookingsUseCase,
} from './application/booking.use-cases';
import { BOOKING_REPOSITORY } from './application/ports/booking.repository';
import { SESSION_RECORD_REPOSITORY } from './application/ports/session-record.repository';
import {
  EndSessionUseCase,
  ListSessionRecordsUseCase,
  StartSessionUseCase,
} from './application/session-record.use-cases';
import { AgendaController } from './http/agenda.controller';
import { BookingSessionsController } from './http/booking-sessions.controller';
import { BookingsController } from './http/bookings.controller';
import { SessionRecordsController } from './http/session-records.controller';
import { PrismaBookingRepository } from './infrastructure/prisma-booking.repository';
import { PrismaSessionRecordRepository } from './infrastructure/prisma-session-record.repository';

@Module({
  imports: [IdempotencyModule],
  controllers: [
    BookingsController,
    BookingSessionsController,
    AgendaController,
    SessionRecordsController,
  ],
  providers: [
    CreateBookingUseCase,
    ListMyBookingsUseCase,
    CancelBookingUseCase,
    GetDayAgendaUseCase,
    StartSessionUseCase,
    EndSessionUseCase,
    ListSessionRecordsUseCase,
    { provide: BOOKING_REPOSITORY, useClass: PrismaBookingRepository },
    { provide: SESSION_RECORD_REPOSITORY, useClass: PrismaSessionRecordRepository },
  ],
})
export class BookingsModule {}
