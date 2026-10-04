import { Module } from '@nestjs/common';
import {
  CENTER_BRANDING_REPOSITORY,
  GetCenterBrandingUseCase,
} from './application/get-center-branding.use-case';
import { BrandingController } from './http/branding.controller';
import { PrismaCenterBrandingRepository } from './infrastructure/prisma-center-branding.repository';

@Module({
  controllers: [BrandingController],
  providers: [
    GetCenterBrandingUseCase,
    { provide: CENTER_BRANDING_REPOSITORY, useClass: PrismaCenterBrandingRepository },
  ],
})
export class CentersModule {}
