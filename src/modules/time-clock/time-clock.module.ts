import { Module } from '@nestjs/common';
import { TIME_ENTRY_REPOSITORY } from './application/ports/time-entry.repository';
import {
  CreateTimeEntryUseCase,
  DeleteTimeEntryUseCase,
  ListTimeEntriesUseCase,
  RecordTeamClockScanUseCase,
  UpdateTimeEntryUseCase,
} from './application/time-entry.use-cases';
import { TimeEntriesController } from './http/time-entries.controller';
import { PrismaTimeEntryRepository } from './infrastructure/prisma-time-entry.repository';

/** Fichaje del equipo. No depende de `bookings`: el escáner de asistencia le delega el fichaje. */
@Module({
  controllers: [TimeEntriesController],
  providers: [
    ListTimeEntriesUseCase,
    CreateTimeEntryUseCase,
    UpdateTimeEntryUseCase,
    DeleteTimeEntryUseCase,
    RecordTeamClockScanUseCase,
    { provide: TIME_ENTRY_REPOSITORY, useClass: PrismaTimeEntryRepository },
  ],
  exports: [RecordTeamClockScanUseCase],
})
export class TimeClockModule {}
