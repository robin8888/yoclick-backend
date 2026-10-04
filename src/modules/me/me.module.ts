import { Module } from '@nestjs/common';
import { AuthIdentityModule } from '../auth/auth-identity.module';
import { DeleteMyAccountUseCase } from './application/delete-my-account.use-case';
import { ExportMyDataUseCase } from './application/export-my-data.use-case';
import { GetMyConsentsUseCase } from './application/get-my-consents.use-case';
import { GetMyProfileUseCase } from './application/get-my-profile.use-case';
import { ListMyMembershipsUseCase } from './application/list-my-memberships.use-case';
import { ACCOUNT_ERASURE_REPOSITORY } from './application/ports/account-erasure.repository';
import { PROFILE_REPOSITORY } from './application/ports/profile.repository';
import { SetMyConsentUseCase } from './application/set-my-consent.use-case';
import { UpdateMyProfileUseCase } from './application/update-my-profile.use-case';
import { MeAccountController } from './http/me-account.controller';
import { MeController } from './http/me.controller';
import { PrismaAccountErasureRepository } from './infrastructure/prisma-account-erasure.repository';
import { PrismaProfileRepository } from './infrastructure/prisma-profile.repository';

@Module({
  imports: [AuthIdentityModule],
  controllers: [MeController, MeAccountController],
  providers: [
    GetMyProfileUseCase,
    UpdateMyProfileUseCase,
    ListMyMembershipsUseCase,
    GetMyConsentsUseCase,
    SetMyConsentUseCase,
    ExportMyDataUseCase,
    DeleteMyAccountUseCase,
    { provide: PROFILE_REPOSITORY, useClass: PrismaProfileRepository },
    { provide: ACCOUNT_ERASURE_REPOSITORY, useClass: PrismaAccountErasureRepository },
  ],
})
export class MeModule {}
