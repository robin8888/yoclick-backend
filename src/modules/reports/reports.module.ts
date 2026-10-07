import { Module } from '@nestjs/common';
import { GetCenterDaySummaryUseCase } from './application/get-center-day-summary.use-case';
import { GetCenterReportUseCase } from './application/get-center-report.use-case';
import { CENTER_REPORT_REPOSITORY } from './application/ports/center-report.repository';
import { DAY_SUMMARY_REPOSITORY } from './application/ports/day-summary.repository';
import { CenterReportController } from './http/center-report.controller';
import { DaySummaryController } from './http/day-summary.controller';
import { PrismaCenterReportRepository } from './infrastructure/prisma-center-report.repository';
import { PrismaDaySummaryRepository } from './infrastructure/prisma-day-summary.repository';

@Module({
  controllers: [DaySummaryController, CenterReportController],
  providers: [
    GetCenterDaySummaryUseCase,
    GetCenterReportUseCase,
    { provide: DAY_SUMMARY_REPOSITORY, useClass: PrismaDaySummaryRepository },
    { provide: CENTER_REPORT_REPOSITORY, useClass: PrismaCenterReportRepository },
  ],
})
export class ReportsModule {}
