import { Module } from '@nestjs/common';
import { GetCenterDaySummaryUseCase } from './application/get-center-day-summary.use-case';
import { DAY_SUMMARY_REPOSITORY } from './application/ports/day-summary.repository';
import { DaySummaryController } from './http/day-summary.controller';
import { PrismaDaySummaryRepository } from './infrastructure/prisma-day-summary.repository';

@Module({
  controllers: [DaySummaryController],
  providers: [
    GetCenterDaySummaryUseCase,
    { provide: DAY_SUMMARY_REPOSITORY, useClass: PrismaDaySummaryRepository },
  ],
})
export class ReportsModule {}
