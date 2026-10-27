import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MILLISECONDS_PER_SECOND } from '../../../shared/time/time-units';
import { SweepSubscriptionsUseCase } from './billing.use-cases';

/**
 * Abre la gracia de las pruebas acabadas sin plan y suspende a quien agota la suya. Corre dentro de la
 * propia API y es idempotente. `BILLING_SWEEP_INTERVAL_SECONDS=0` (por defecto) lo apaga: encenderlo
 * suspende los centros cuya prueba lleva más de 14 días y 7 de gracia sin plan.
 */
@Injectable()
export class SubscriptionSweeper implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SubscriptionSweeper.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly sweep: SweepSubscriptionsUseCase,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const intervalSeconds = Number(this.config.get('BILLING_SWEEP_INTERVAL_SECONDS') ?? 0);
    if (intervalSeconds <= 0) return;
    this.timer = setInterval(() => {
      this.sweep
        .execute(new Date())
        .then((summary) => {
          if (summary.gracesOpened + summary.centersSuspended > 0) {
            this.logger.log(
              `Opened ${String(summary.gracesOpened)} graces, suspended ${String(summary.centersSuspended)} centers`,
            );
          }
        })
        .catch((error: unknown) => {
          this.logger.error('The subscription sweep failed', error);
        });
    }, intervalSeconds * MILLISECONDS_PER_SECOND);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
