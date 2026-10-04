import { Module } from '@nestjs/common';
import { IdempotencyModule } from '../../shared/idempotency/idempotency.module';
import { CreateCenterUseCase } from './application/create-center.use-case';
import { CENTER_CREATION_REPOSITORY } from './application/ports/center-creation.repository';
import { OnboardingController } from './http/onboarding.controller';
import { PrismaCenterCreationRepository } from './infrastructure/prisma-center-creation.repository';

@Module({
  imports: [IdempotencyModule],
  controllers: [OnboardingController],
  providers: [
    CreateCenterUseCase,
    { provide: CENTER_CREATION_REPOSITORY, useClass: PrismaCenterCreationRepository },
  ],
})
export class OnboardingModule {}
