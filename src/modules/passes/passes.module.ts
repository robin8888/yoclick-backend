import { Module } from '@nestjs/common';
import {
  ArchiveRateUseCase,
  AssignPassUseCase,
  CreateRateUseCase,
  DecidePassUseCase,
  ListEligibleClientsUseCase,
  ListPassesUseCase,
  ListRatesUseCase,
  RequestPassUseCase,
  UpdateRateUseCase,
} from './application/pass.use-cases';
import { PASS_REPOSITORY } from './application/ports/pass.repository';
import { PassesController, RatesController } from './http/passes.controller';
import { PrismaPassRepository } from './infrastructure/prisma-pass.repository';

@Module({
  controllers: [RatesController, PassesController],
  providers: [
    ListRatesUseCase,
    CreateRateUseCase,
    UpdateRateUseCase,
    ArchiveRateUseCase,
    RequestPassUseCase,
    AssignPassUseCase,
    ListPassesUseCase,
    DecidePassUseCase,
    ListEligibleClientsUseCase,
    { provide: PASS_REPOSITORY, useClass: PrismaPassRepository },
  ],
})
export class PassesModule {}
