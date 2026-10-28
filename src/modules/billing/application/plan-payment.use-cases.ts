import { Inject, Injectable, Logger } from '@nestjs/common';
import { EMAIL_SENDER, type EmailSender } from '../../../shared/email/email-sender';
import {
  describeReminderReason,
  selectDueReminderKind,
  type PlanPaymentEmailKind,
} from '../domain/plan-payment-reminders';
import { openCheckoutSession } from './open-checkout-session';
import {
  PLAN_PAYMENT_LINK_LIFETIME_DAYS,
  PlanPaymentLinkService,
  type PlanPaymentLinkClaims,
} from './plan-payment-link.service';
import { buildPlanPaymentMessage, type PlanPaymentOption } from './plan-payment-message';
import { BILLING_GATEWAY, type BillingGateway } from './ports/billing-gateway';
import {
  BILLING_REPOSITORY,
  type BillingRepository,
  type PlanOffer,
  type TrialReminderCandidate,
} from './ports/billing.repository';

/** Quien abre un enlace de un correo no tiene sesión: la página de pago se prepara en el contexto de cobro. */
@Injectable()
export class OpenPlanPaymentLinkUseCase {
  constructor(
    @Inject(BILLING_REPOSITORY) private readonly billing: BillingRepository,
    @Inject(BILLING_GATEWAY) private readonly gateway: BillingGateway,
    private readonly paymentLinks: PlanPaymentLinkService,
  ) {}

  async execute(token: string): Promise<{ url: string }> {
    const claims = await this.paymentLinks.verify(token);
    const facts = await this.billing.runInTransaction((transaction) =>
      transaction.findCheckoutFactsForCenter(claims.centerId, claims.planId),
    );
    return openCheckoutSession({
      gateway: this.gateway,
      facts,
      choice: claims,
      saveCustomerId: (customerId) =>
        this.billing.runInTransaction((transaction) =>
          transaction.saveCustomerIdForCenter(claims.centerId, customerId),
        ),
    });
  }
}

export interface PlanPaymentEmailSummary {
  readonly emailsSent: number;
  readonly centersFailed: number;
}

/** Los dos enlaces (mensual y anual) de cada plan que se puede contratar, ya firmados para este centro. */
async function buildPlanOptions(
  paymentLinks: PlanPaymentLinkService,
  centerId: string,
  offers: readonly PlanOffer[],
): Promise<PlanPaymentOption[]> {
  return Promise.all(
    offers.map(async (offer) => {
      const claims = { centerId, planId: offer.id as PlanPaymentLinkClaims['planId'] };
      return {
        name: offer.name,
        monthlyPriceCents: offer.monthlyPriceCents,
        annualMonthlyPriceCents: offer.annualMonthlyPriceCents,
        monthlyUrl: await paymentLinks.buildUrl({ ...claims, period: 'monthly' }),
        annualUrl: await paymentLinks.buildUrl({ ...claims, period: 'annual' }),
      };
    }),
  );
}

/**
 * Avisos de fin de prueba con los enlaces de pago (docs/spec/17): a los 7, 3 y 1 días y al acabar, solo a
 * centros sin suscripción y una sola vez por tipo. El envío se apunta y se manda en la misma transacción:
 * si el correo falla, el apunte se deshace y el siguiente barrido lo reintenta.
 */
@Injectable()
export class SendPlanPaymentEmailsUseCase {
  private readonly logger = new Logger(SendPlanPaymentEmailsUseCase.name);

  constructor(
    @Inject(BILLING_REPOSITORY) private readonly billing: BillingRepository,
    @Inject(EMAIL_SENDER) private readonly emailSender: EmailSender,
    private readonly paymentLinks: PlanPaymentLinkService,
  ) {}

  async execute(now: Date): Promise<PlanPaymentEmailSummary> {
    const { candidates, offers } = await this.billing.runInTransaction(async (transaction) => ({
      candidates: await transaction.listTrialReminderCandidates(now),
      offers: await transaction.listAvailablePlanOffers(),
    }));
    let emailsSent = 0;
    let centersFailed = 0;
    for (const candidate of candidates) {
      const kind = this.findDueKind(candidate, now);
      if (kind === null || offers.length === 0) continue;
      try {
        emailsSent += await this.sendReminder({ candidate, kind, offers });
      } catch (error: unknown) {
        centersFailed += 1;
        this.logger.error(`The plan payment email failed for center ${candidate.center.id}`, error);
      }
    }
    return { emailsSent, centersFailed };
  }

  private findDueKind(candidate: TrialReminderCandidate, now: Date): PlanPaymentEmailKind | null {
    const { trialEndsAt } = candidate.center;
    if (trialEndsAt === null) return null;
    return selectDueReminderKind({ trialEndsAt, now, sentKinds: candidate.sentKinds });
  }

  /** Devuelve cuántos correos salieron: 0 si otra vuelta ya había apuntado este aviso. */
  private async sendReminder(input: {
    candidate: TrialReminderCandidate;
    kind: PlanPaymentEmailKind;
    offers: readonly PlanOffer[];
  }): Promise<number> {
    const { candidate, kind, offers } = input;
    const plans = await buildPlanOptions(this.paymentLinks, candidate.center.id, offers);
    return this.billing.runInTransaction(async (transaction) => {
      if (!(await transaction.claimPlanPaymentEmail(candidate.center.id, kind))) return 0;
      for (const owner of candidate.owners) {
        await this.emailSender.send(
          buildPlanPaymentMessage({
            to: owner.email,
            fullName: owner.fullName,
            centerName: candidate.center.name,
            reason: describeReminderReason(kind),
            plans,
            linkValidForDays: PLAN_PAYMENT_LINK_LIFETIME_DAYS,
          }),
        );
      }
      return candidate.owners.length;
    });
  }
}
