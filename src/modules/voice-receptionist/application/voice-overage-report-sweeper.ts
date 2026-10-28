import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MILLISECONDS_PER_SECOND } from '../../../shared/time/time-units';
import { ReportVoiceOverageUseCase } from './report-voice-overage.use-case';

/** Cada cuánto se reintenta el exceso pendiente si no se configura otra cosa. */
const DEFAULT_SWEEP_INTERVAL_SECONDS = 300;

/**
 * Reintenta comunicar a Stripe el exceso de minutos de las llamadas que no llegaron a comunicarse al terminar
 * (Stripe caído, un corte). Corre dentro de la API; `VOICE_OVERAGE_REPORT_INTERVAL_SECONDS=0` lo apaga (los tests
 * lo lanzan a mano con `sweep`). Reintentar es seguro: cada llamada lleva su propio identificador.
 */
@Injectable()
export class VoiceOverageReportSweeper implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(VoiceOverageReportSweeper.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly overage: ReportVoiceOverageUseCase,
    private readonly config: ConfigService,
  ) {}

  sweep(now: Date = new Date()): Promise<{ reportedCalls: number; failedCalls: number }> {
    return this.overage.reportPending(now);
  }

  onModuleInit(): void {
    const intervalSeconds = Number(
      this.config.get('VOICE_OVERAGE_REPORT_INTERVAL_SECONDS') ?? DEFAULT_SWEEP_INTERVAL_SECONDS,
    );
    if (intervalSeconds <= 0) return;
    this.timer = setInterval(() => {
      this.sweep().catch((error: unknown) => {
        this.logger.error('The voice overage report sweep failed', error);
      });
    }, intervalSeconds * MILLISECONDS_PER_SECOND);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
