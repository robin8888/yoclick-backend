import { Module } from '@nestjs/common';
import {
  GetPlatformCenterUseCase,
  GetPlatformOverviewUseCase,
  ListPlatformAuditUseCase,
  ListPlatformCentersUseCase,
  ListPlatformPlansUseCase,
  UpdatePlatformCenterUseCase,
  UpdatePlatformPlanPricesUseCase,
} from './application/platform.use-cases';
import {
  PLATFORM_PLAN_REPOSITORY,
  PLATFORM_REPOSITORY,
} from './application/ports/platform.repository';
import { PlatformController } from './http/platform.controller';
import { PlatformPlansController } from './http/platform-plans.controller';
import { PrismaPlatformPlanRepository } from './infrastructure/prisma-platform-plan.repository';
import { PrismaPlatformRepository } from './infrastructure/prisma-platform.repository';

@Module({
  controllers: [PlatformController, PlatformPlansController],
  providers: [
    { provide: PLATFORM_REPOSITORY, useClass: PrismaPlatformRepository },
    { provide: PLATFORM_PLAN_REPOSITORY, useClass: PrismaPlatformPlanRepository },
    GetPlatformOverviewUseCase,
    ListPlatformCentersUseCase,
    GetPlatformCenterUseCase,
    UpdatePlatformCenterUseCase,
    ListPlatformAuditUseCase,
    ListPlatformPlansUseCase,
    UpdatePlatformPlanPricesUseCase,
  ],
})
export class PlatformModule {}
