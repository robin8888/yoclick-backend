import { Module } from '@nestjs/common';
import {
  GetPlatformCenterUseCase,
  GetPlatformOverviewUseCase,
  ListPlatformAuditUseCase,
  ListPlatformCentersUseCase,
  UpdatePlatformCenterUseCase,
} from './application/platform.use-cases';
import { PLATFORM_REPOSITORY } from './application/ports/platform.repository';
import { PlatformController } from './http/platform.controller';
import { PrismaPlatformRepository } from './infrastructure/prisma-platform.repository';

@Module({
  controllers: [PlatformController],
  providers: [
    { provide: PLATFORM_REPOSITORY, useClass: PrismaPlatformRepository },
    GetPlatformOverviewUseCase,
    ListPlatformCentersUseCase,
    GetPlatformCenterUseCase,
    UpdatePlatformCenterUseCase,
    ListPlatformAuditUseCase,
  ],
})
export class PlatformModule {}
