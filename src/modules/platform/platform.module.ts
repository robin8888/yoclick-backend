import { Module } from '@nestjs/common';
import {
  ExportPlatformChargesCsvUseCase,
  GetPlatformCenterUseCase,
  GetPlatformChargeReportUseCase,
  GetPlatformOverviewUseCase,
  ListPlatformAuditUseCase,
  ListPlatformCentersUseCase,
  ListPlatformChargesUseCase,
  ListPlatformPlansUseCase,
  RecordPlatformChargeUseCase,
  UpdatePlatformCenterUseCase,
  UpdatePlatformChargeUseCase,
  UpdatePlatformPlanPricesUseCase,
} from './application/platform.use-cases';
import {
  PLATFORM_CHARGE_REPOSITORY,
  PLATFORM_PLAN_REPOSITORY,
  PLATFORM_REPOSITORY,
} from './application/ports/platform.repository';
import { PlatformChargesController } from './http/platform-charges.controller';
import { PlatformController } from './http/platform.controller';
import { PlatformPlansController } from './http/platform-plans.controller';
import { PrismaPlatformChargeRepository } from './infrastructure/prisma-platform-charge.repository';
import { PrismaPlatformPlanRepository } from './infrastructure/prisma-platform-plan.repository';
import { PrismaPlatformRepository } from './infrastructure/prisma-platform.repository';

@Module({
  controllers: [PlatformController, PlatformPlansController, PlatformChargesController],
  providers: [
    { provide: PLATFORM_REPOSITORY, useClass: PrismaPlatformRepository },
    { provide: PLATFORM_PLAN_REPOSITORY, useClass: PrismaPlatformPlanRepository },
    { provide: PLATFORM_CHARGE_REPOSITORY, useClass: PrismaPlatformChargeRepository },
    GetPlatformOverviewUseCase,
    ListPlatformCentersUseCase,
    GetPlatformCenterUseCase,
    UpdatePlatformCenterUseCase,
    ListPlatformAuditUseCase,
    ListPlatformPlansUseCase,
    UpdatePlatformPlanPricesUseCase,
    ListPlatformChargesUseCase,
    RecordPlatformChargeUseCase,
    UpdatePlatformChargeUseCase,
    GetPlatformChargeReportUseCase,
    ExportPlatformChargesCsvUseCase,
  ],
})
export class PlatformModule {}
