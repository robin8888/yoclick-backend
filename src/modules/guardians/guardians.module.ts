import { Module } from '@nestjs/common';
import {
  LinkGuardianUseCase,
  ListGuardiansUseCase,
  ListMyChildrenUseCase,
  UnlinkGuardianUseCase,
} from './application/guardian.use-cases';
import { GUARDIAN_REPOSITORY } from './application/ports/guardian.repository';
import { ClientGuardiansController, MyChildrenController } from './http/guardians.controller';
import { PrismaGuardianRepository } from './infrastructure/prisma-guardian.repository';

/** Tutores: enlaces entre una persona adulta y los menores a su cargo. */
@Module({
  controllers: [ClientGuardiansController, MyChildrenController],
  providers: [
    LinkGuardianUseCase,
    ListGuardiansUseCase,
    ListMyChildrenUseCase,
    UnlinkGuardianUseCase,
    { provide: GUARDIAN_REPOSITORY, useClass: PrismaGuardianRepository },
  ],
})
export class GuardiansModule {}
