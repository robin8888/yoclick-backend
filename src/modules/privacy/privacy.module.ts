import { Module } from '@nestjs/common';
import { AuthIdentityModule } from '../auth/auth-identity.module';
import { GetConsentSummaryUseCase } from './application/get-consent-summary.use-case';
import { PRIVACY_REQUEST_REPOSITORY } from './application/ports/privacy-request.repository';
import {
  CreatePrivacyRequestUseCase,
  ExportClientDataUseCase,
  ListPrivacyRequestsUseCase,
  ResolvePrivacyRequestUseCase,
} from './application/privacy-request.use-cases';
import { ClientDataExportController } from './http/client-data-export.controller';
import { PrivacyController } from './http/privacy.controller';
import { PrivacyRequestsController } from './http/privacy-requests.controller';
import { PrismaPrivacyRequestRepository } from './infrastructure/prisma-privacy-request.repository';

@Module({
  imports: [AuthIdentityModule],
  controllers: [PrivacyController, PrivacyRequestsController, ClientDataExportController],
  providers: [
    GetConsentSummaryUseCase,
    CreatePrivacyRequestUseCase,
    ListPrivacyRequestsUseCase,
    ResolvePrivacyRequestUseCase,
    ExportClientDataUseCase,
    { provide: PRIVACY_REQUEST_REPOSITORY, useClass: PrismaPrivacyRequestRepository },
  ],
})
export class PrivacyModule {}
