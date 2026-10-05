import { Module } from '@nestjs/common';
import { IdempotencyModule } from '../../shared/idempotency/idempotency.module';
import { CreateCenterUseCase } from './application/create-center.use-case';
import { CENTER_LOGO_REPOSITORY } from './application/ports/center-logo.repository';
import { CENTER_CREATION_REPOSITORY } from './application/ports/center-creation.repository';
import { UploadCenterLogoUseCase } from './application/upload-center-logo.use-case';
import { OnboardingController } from './http/onboarding.controller';
import { PrismaCenterLogoRepository } from './infrastructure/prisma-center-logo.repository';
import { PrismaCenterCreationRepository } from './infrastructure/prisma-center-creation.repository';

@Module({
  imports: [IdempotencyModule],
  controllers: [OnboardingController],
  providers: [
    CreateCenterUseCase,
    UploadCenterLogoUseCase,
    { provide: CENTER_LOGO_REPOSITORY, useClass: PrismaCenterLogoRepository },
    { provide: CENTER_CREATION_REPOSITORY, useClass: PrismaCenterCreationRepository },
  ],
})
export class OnboardingModule {}
