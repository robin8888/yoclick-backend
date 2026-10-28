import { Inject, Injectable, Logger } from '@nestjs/common';
import { calculateBilledMinutes } from '../domain/usage-minutes';
import { type VoiceCallEnd } from './ports/voice-agent-provider';
import {
  VOICE_CALL_REPOSITORY,
  type VoiceCallFinishOutcome,
  type VoiceCallRepository,
} from './ports/voice-call.repository';
import { ReportVoiceOverageUseCase } from './report-voice-overage.use-case';
import { SendVoiceUsageAlertsUseCase } from './send-voice-usage-alerts.use-case';

/**
 * El aviso de fin de llamada: guarda su duración, resumen y transcripción y suma los minutos al periodo del
 * centro (de ahí sale el exceso que se factura). Se acepta aunque el centro haya apagado el servicio a mitad de
 * llamada: los minutos ya consumidos cuentan igual. El centro sale del número puente, como siempre.
 *
 * Después de guardar la llamada se comunica a Stripe su exceso de minutos y se avisa al centro si ha cruzado el
 * 80 % o el 100 %. Eso es del cobro y no de la llamada: si falla, el aviso del proveedor se atiende igual (los
 * minutos ya están guardados) y el exceso lo reintenta el barrido.
 */
@Injectable()
export class HandleVoiceCallEndUseCase {
  private readonly logger = new Logger(HandleVoiceCallEndUseCase.name);

  constructor(
    @Inject(VOICE_CALL_REPOSITORY) private readonly calls: VoiceCallRepository,
    private readonly overage: ReportVoiceOverageUseCase,
    private readonly alerts: SendVoiceUsageAlertsUseCase,
  ) {}

  async execute(end: VoiceCallEnd): Promise<{ isAccepted: boolean }> {
    const line = await this.calls.findLineByNumber(end.calledNumber);
    if (line === null) return { isAccepted: false };
    const outcome = await this.calls.finishCall(
      line.centerId,
      end,
      calculateBilledMinutes(end.durationSeconds),
    );
    await this.overage.reportCall(outcome.callLogId);
    await this.sendAlerts(line.centerId, outcome);
    return { isAccepted: true };
  }

  private async sendAlerts(centerId: string, outcome: VoiceCallFinishOutcome): Promise<void> {
    if (outcome.usage === null || outcome.alertsToSend.length === 0) return;
    try {
      await this.alerts.execute({
        centerId,
        percents: outcome.alertsToSend,
        usage: outcome.usage,
      });
    } catch (error: unknown) {
      this.logger.error(`The voice usage alerts failed for center ${centerId}`, error);
    }
  }
}
