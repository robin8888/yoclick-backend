import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MILLISECONDS_PER_SECOND } from '../../../shared/time/time-units';
import { SendPlanPaymentEmailsUseCase } from './plan-payment.use-cases';

/**
 * Envía los correos de pago del plan (avisos de fin de prueba). Corre dentro de la propia API y es idempotente
 * (cada aviso se apunta y no se repite). `PLAN_PAYMENT_EMAIL_INTERVAL_SECONDS=0` (por defecto) lo apaga:
 * encenderlo escribe a los propietarios de los centros cuya prueba acaba en 7 días o acabó hace menos de 7.
 */
@Injectable()
export class PlanPaymentEmailScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PlanPaymentEmailScheduler.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly sendEmails: SendPlanPaymentEmailsUseCase,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const intervalSeconds = Number(this.config.get('PLAN_PAYMENT_EMAIL_INTERVAL_SECONDS') ?? 0);
    if (intervalSeconds <= 0) return;
    this.timer = setInterval(() => {
      this.sendEmails
        .execute(new Date())
        .then((summary) => {
          if (summary.emailsSent + summary.centersFailed > 0) {
            this.logger.log(
              `Sent ${String(summary.emailsSent)} plan payment emails, ${String(summary.centersFailed)} centers failed`,
            );
          }
        })
        .catch((error: unknown) => {
          this.logger.error('The plan payment email run failed', error);
        });
    }, intervalSeconds * MILLISECONDS_PER_SECOND);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
