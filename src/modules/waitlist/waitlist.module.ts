import { Module } from '@nestjs/common';
import { WAITLIST_REPOSITORY } from './application/ports/waitlist.repository';
import { WaitlistSweeper } from './application/waitlist-sweeper';
import {
  ConfirmWaitlistOfferUseCase,
  JoinWaitlistUseCase,
  LeaveWaitlistUseCase,
  ListMyWaitlistUseCase,
  ListSessionWaitlistUseCase,
  RemoveFromSessionWaitlistUseCase,
  WaitlistAdvancer,
} from './application/waitlist.use-cases';
import { SessionWaitlistController } from './http/session-waitlist.controller';
import { WaitlistController } from './http/waitlist.controller';
import { PrismaWaitlistRepository } from './infrastructure/prisma-waitlist.repository';

@Module({
  controllers: [WaitlistController, SessionWaitlistController],
  providers: [
    JoinWaitlistUseCase,
    LeaveWaitlistUseCase,
    ListMyWaitlistUseCase,
    ListSessionWaitlistUseCase,
    RemoveFromSessionWaitlistUseCase,
    ConfirmWaitlistOfferUseCase,
    WaitlistAdvancer,
    WaitlistSweeper,
    { provide: WAITLIST_REPOSITORY, useClass: PrismaWaitlistRepository },
  ],
  exports: [WaitlistAdvancer],
})
export class WaitlistModule {}
