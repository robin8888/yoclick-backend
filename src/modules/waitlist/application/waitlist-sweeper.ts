import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MILLISECONDS_PER_SECOND } from '../../../shared/time/time-units';
import { WaitlistAdvancer } from './waitlist.use-cases';

/** Cada cuánto se miran las ofertas vencidas si no se configura otra cosa. */
const DEFAULT_SWEEP_INTERVAL_SECONDS = 60;

/**
 * Pasa la plaza a la siguiente persona cuando se vence una oferta de 12 horas. Corre dentro de la
 * propia API; si hubiera varias instancias, el avance es idempotente y no se duplica nada.
 * `WAITLIST_SWEEP_INTERVAL_SECONDS=0` lo apaga (los tests lo lanzan a mano).
 */
@Injectable()
export class WaitlistSweeper implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WaitlistSweeper.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly advancer: WaitlistAdvancer,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const intervalSeconds = Number(
      this.config.get('WAITLIST_SWEEP_INTERVAL_SECONDS') ?? DEFAULT_SWEEP_INTERVAL_SECONDS,
    );
    if (intervalSeconds <= 0) return;
    this.timer = setInterval(() => {
      this.advancer.sweepExpiredOffers().catch((error: unknown) => {
        this.logger.error('The waitlist sweep failed', error);
      });
    }, intervalSeconds * MILLISECONDS_PER_SECOND);
    // No retiene el proceso al apagar: Nest lo para en `onModuleDestroy`.
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
