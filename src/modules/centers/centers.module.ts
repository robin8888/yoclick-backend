import { Module } from '@nestjs/common';
import {
  CENTER_BRANDING_REPOSITORY,
  GetCenterBrandingUseCase,
} from './application/get-center-branding.use-case';
import {
  GetCenterSettingsUseCase,
  UpdateCenterSettingsUseCase,
} from './application/center-settings.use-cases';
import { CENTER_SETTINGS_REPOSITORY } from './application/ports/center-settings.repository';
import { GetCenterLogoUseCase } from './application/get-center-logo.use-case';
import { CENTER_LOGO_READER } from './application/ports/center-logo-reader.repository';
import {
  GetJoinStatsUseCase,
  RegenerateJoinCodeUseCase,
} from './application/center-sharing.use-cases';
import { CENTER_SHARING_REPOSITORY } from './application/ports/center-sharing.repository';
import { GetCenterSubscriptionUseCase } from './application/get-center-subscription.use-case';
import { CENTER_SUBSCRIPTION_REPOSITORY } from './application/ports/center-subscription.repository';
import { CenterSubscriptionController } from './http/center-subscription.controller';
import { PrismaCenterSubscriptionRepository } from './infrastructure/prisma-center-subscription.repository';
import { CenterSharingController } from './http/center-sharing.controller';
import { PrismaCenterSharingRepository } from './infrastructure/prisma-center-sharing.repository';
import { LogoController } from './http/logo.controller';
import { PrismaCenterLogoReader } from './infrastructure/prisma-center-logo-reader.repository';
import { BrandingController } from './http/branding.controller';
import { CenterSettingsController } from './http/center-settings.controller';
import { PrismaCenterSettingsRepository } from './infrastructure/prisma-center-settings.repository';
import { PrismaCenterBrandingRepository } from './infrastructure/prisma-center-branding.repository';

@Module({
  controllers: [
    BrandingController,
    CenterSettingsController,
    CenterSharingController,
    CenterSubscriptionController,
    LogoController,
  ],
  providers: [
    GetCenterBrandingUseCase,
    GetCenterLogoUseCase,
    { provide: CENTER_LOGO_READER, useClass: PrismaCenterLogoReader },
    GetJoinStatsUseCase,
    RegenerateJoinCodeUseCase,
    { provide: CENTER_SHARING_REPOSITORY, useClass: PrismaCenterSharingRepository },
    GetCenterSubscriptionUseCase,
    { provide: CENTER_SUBSCRIPTION_REPOSITORY, useClass: PrismaCenterSubscriptionRepository },
    GetCenterSettingsUseCase,
    UpdateCenterSettingsUseCase,
    { provide: CENTER_SETTINGS_REPOSITORY, useClass: PrismaCenterSettingsRepository },
    { provide: CENTER_BRANDING_REPOSITORY, useClass: PrismaCenterBrandingRepository },
  ],
})
export class CentersModule {}
