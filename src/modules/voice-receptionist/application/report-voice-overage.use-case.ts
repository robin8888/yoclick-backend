import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  BILLING_GATEWAY,
  type BillingGateway,
} from '../../billing/application/ports/billing-gateway';
import { buildOverageMeterIdentifier } from '../domain/usage-minutes';
import {
  VOICE_OVERAGE_REPOSITORY,
  type ReportableVoiceOverage,
  type VoiceOverageRepository,
} from './ports/voice-overage.repository';

const PENDING_BATCH_SIZE = 100;

export interface PendingOverageSummary {
  readonly reportedCalls: number;
  readonly failedCalls: number;
}

/**
 * Comunica a Stripe el exceso de minutos de las llamadas (el medidor del add-on lo factura al cerrar el periodo).
 *
 * Nunca se cuenta dos veces: cada llamada lleva un identificador propio, que Stripe descarta si lo recibe de
 * nuevo (ventana de al menos 24 horas), y además la llamada queda marcada como comunicada. Si Stripe falla, la
 * llamada queda pendiente y la reintenta el barrido con el mismo identificador. Solo se comunica lo de centros
 * con cliente de Stripe y línea de uso medido: un centro piloto, sin cobro, nunca genera nada.
 */
@Injectable()
export class ReportVoiceOverageUseCase {
  private readonly logger = new Logger(ReportVoiceOverageUseCase.name);

  constructor(
    @Inject(VOICE_OVERAGE_REPOSITORY) private readonly overages: VoiceOverageRepository,
    @Inject(BILLING_GATEWAY) private readonly gateway: BillingGateway,
  ) {}

  /** Justo al cerrar la llamada. Un fallo no se propaga: el aviso del proveedor se atiende igual y reintenta el barrido. */
  async reportCall(callLogId: string, now: Date = new Date()): Promise<void> {
    try {
      const call = await this.overages.findReportableCall(callLogId, now);
      if (call !== null) await this.report(call, now);
    } catch (error: unknown) {
      this.logger.error(`Reporting the voice overage of call ${callLogId} failed`, error);
    }
  }

  async reportPending(now: Date = new Date()): Promise<PendingOverageSummary> {
    const pending = await this.overages.listReportableCalls(now, PENDING_BATCH_SIZE);
    let reportedCalls = 0;
    let failedCalls = 0;
    for (const call of pending) {
      try {
        await this.report(call, now);
        reportedCalls += 1;
      } catch (error: unknown) {
        failedCalls += 1;
        this.logger.error(`Reporting the voice overage of call ${call.callLogId} failed`, error);
      }
    }
    return { reportedCalls, failedCalls };
  }

  private async report(call: ReportableVoiceOverage, now: Date): Promise<void> {
    await this.gateway.reportVoiceOverage({
      customerId: call.stripeCustomerId,
      minutes: call.minutes,
      identifier: buildOverageMeterIdentifier(call.callLogId),
      occurredAt: call.endedAt,
    });
    await this.overages.markReported(call.callLogId, now);
  }
}
