import { Module } from '@nestjs/common';
import { GetConsentSummaryUseCase } from './application/get-consent-summary.use-case';
import { PrivacyController } from './http/privacy.controller';

@Module({
  controllers: [PrivacyController],
  providers: [GetConsentSummaryUseCase],
})
export class PrivacyModule {}
