import { Module } from '@nestjs/common';
import { FindCenterByJoinCodeUseCase } from './application/find-center-by-join-code.use-case';
import { JoinCenterUseCase } from './application/join-center.use-case';
import { JOIN_REPOSITORY } from './application/ports/join.repository';
import { SearchCentersUseCase } from './application/search-centers.use-case';
import { JoinController } from './http/join.controller';
import { PrismaJoinRepository } from './infrastructure/prisma-join.repository';

@Module({
  controllers: [JoinController],
  providers: [
    FindCenterByJoinCodeUseCase,
    SearchCentersUseCase,
    JoinCenterUseCase,
    { provide: JOIN_REPOSITORY, useClass: PrismaJoinRepository },
  ],
})
export class JoinModule {}
