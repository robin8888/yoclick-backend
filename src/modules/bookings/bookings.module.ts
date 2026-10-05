import { Module } from '@nestjs/common';
import { IdempotencyModule } from '../../shared/idempotency/idempotency.module';
import {
  CancelBookingUseCase,
  CreateBookingUseCase,
  GetDayAgendaUseCase,
  ListMyBookingsUseCase,
} from './application/booking.use-cases';
import { BOOKING_REPOSITORY } from './application/ports/booking.repository';
import { AgendaController } from './http/agenda.controller';
import { BookingsController } from './http/bookings.controller';
import { PrismaBookingRepository } from './infrastructure/prisma-booking.repository';

@Module({
  imports: [IdempotencyModule],
  controllers: [BookingsController, AgendaController],
  providers: [
    CreateBookingUseCase,
    ListMyBookingsUseCase,
    CancelBookingUseCase,
    GetDayAgendaUseCase,
    { provide: BOOKING_REPOSITORY, useClass: PrismaBookingRepository },
  ],
})
export class BookingsModule {}
