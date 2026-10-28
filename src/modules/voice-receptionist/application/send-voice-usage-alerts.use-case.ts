import { Inject, Injectable, Logger } from '@nestjs/common';
import { EMAIL_SENDER, type EmailSender } from '../../../shared/email/email-sender';
import {
  BILLING_REPOSITORY,
  type BillingRepository,
} from '../../billing/application/ports/billing.repository';
import { PushDispatcher } from '../../push/application/push-dispatcher';
import { type UsageAlertPercent } from '../domain/usage-minutes';
import {
  VOICE_CALL_REPOSITORY,
  type VoiceCallRepository,
  type VoiceUsageSnapshot,
} from './ports/voice-call.repository';
import { buildVoiceUsageAlertMessage } from './voice-usage-alert-message';

const KIND_BY_PERCENT = {
  80: 'voice_minutes_80',
  100: 'voice_minutes_100',
} as const satisfies Record<UsageAlertPercent, string>;

/**
 * Avisa al centro de que ha usado el 80 % o el 100 % de los minutos incluidos: un aviso dentro de la app con su
 * push a quien administra el centro y un correo al propietario con el detalle (minutos, qué pasará y, si
 * se sigue cobrando el exceso, a cuánto). Cada umbral se avisa una sola vez por periodo: el apunte lo hace
 * `finishCall` antes de llegar aquí.
 */
@Injectable()
export class SendVoiceUsageAlertsUseCase {
  private readonly logger = new Logger(SendVoiceUsageAlertsUseCase.name);

  constructor(
    @Inject(BILLING_REPOSITORY) private readonly billing: BillingRepository,
    @Inject(VOICE_CALL_REPOSITORY) private readonly calls: VoiceCallRepository,
    @Inject(EMAIL_SENDER) private readonly emailSender: EmailSender,
    private readonly pushDispatcher: PushDispatcher,
  ) {}

  async execute(input: {
    centerId: string;
    percents: readonly UsageAlertPercent[];
    usage: VoiceUsageSnapshot;
  }): Promise<void> {
    if (input.percents.length === 0) return;
    const facts = await this.calls.readUsageAlertFacts(input.centerId);
    if (facts === null) return;
    for (const percent of input.percents) {
      const { notifiedActors, owners } = await this.billing.runInTransaction(
        async (transaction) => ({
          notifiedActors: await transaction.notifyOwners({
            centerId: input.centerId,
            kind: KIND_BY_PERCENT[percent],
            includeAdmins: true,
            data: {
              usedMinutes: String(input.usage.usedMinutes),
              includedMinutes: String(input.usage.includedMinutes),
            },
          }),
          owners: await transaction.listOwnerContacts(input.centerId),
        }),
      );
      const [firstRecipient] = notifiedActors;
      if (firstRecipient !== undefined) await this.pushDispatcher.flushCenter(firstRecipient);
      for (const owner of owners) {
        await this.sendEmail({ ...input, percent, facts, owner });
      }
    }
  }

  private async sendEmail(input: {
    centerId: string;
    percent: UsageAlertPercent;
    usage: VoiceUsageSnapshot;
    facts: NonNullable<Awaited<ReturnType<VoiceCallRepository['readUsageAlertFacts']>>>;
    owner: { email: string; fullName: string };
  }): Promise<void> {
    try {
      await this.emailSender.send(
        buildVoiceUsageAlertMessage({
          to: input.owner.email,
          fullName: input.owner.fullName,
          centerName: input.facts.centerName,
          percent: input.percent,
          usedMinutes: input.usage.usedMinutes,
          includedMinutes: input.usage.includedMinutes,
          overagePolicy: input.facts.overagePolicy,
          overageCentsPerMinute: input.facts.overageCentsPerMinute,
        }),
      );
    } catch (error: unknown) {
      // Sin el destinatario en el log: solo el centro y el umbral.
      this.logger.error(
        `The ${String(input.percent)} % voice usage email failed for center ${input.centerId}`,
        error,
      );
    }
  }
}
