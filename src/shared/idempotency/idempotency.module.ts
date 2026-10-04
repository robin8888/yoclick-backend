import { Module } from '@nestjs/common';
import { IDEMPOTENCY_STORE } from './idempotency-store';
import { IdempotencyService } from './idempotency.service';
import { PrismaIdempotencyStore } from './infrastructure/prisma-idempotency-store';

@Module({
  providers: [{ provide: IDEMPOTENCY_STORE, useClass: PrismaIdempotencyStore }, IdempotencyService],
  exports: [IdempotencyService],
})
export class IdempotencyModule {}
