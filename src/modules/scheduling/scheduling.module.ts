import { Module } from '@nestjs/common';
import { GetAvailabilityUseCase } from './application/get-availability.use-case';
import { SCHEDULING_FACTS_REPOSITORY } from './application/ports/scheduling-facts.repository';
import { AvailabilityController } from './http/availability.controller';
import { PrismaSchedulingFactsRepository } from './infrastructure/prisma-scheduling-facts.repository';

@Module({
  controllers: [AvailabilityController],
  providers: [
    GetAvailabilityUseCase,
    { provide: SCHEDULING_FACTS_REPOSITORY, useClass: PrismaSchedulingFactsRepository },
  ],
})
export class SchedulingModule {}
