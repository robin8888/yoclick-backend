import { Inject, Injectable } from '@nestjs/common';
import { v7 as generateUuidV7 } from 'uuid';
import { DomainError } from '../../../shared/errors/domain-error';
import { HTTP_STATUS } from '../../../shared/errors/http-status';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { PAYMENT_GATEWAY, type PaymentGateway } from './ports/payment-gateway';
import {
  PAYMENT_REPOSITORY,
  type CenterPaymentsInfo,
  type PayableTarget,
  type PaymentListItem,
  type PaymentRecord,
  type PaymentRepository,
  type PaymentTarget,
} from './ports/payment.repository';

/** `not_included`: el plan no cobra online. El resto es el avance del alta de cobros en Stripe. */
export type PaymentsStatus = 'not_included' | 'not_started' | 'pending' | 'ready';

export interface PaymentSheetView {
  readonly paymentId: string;
  readonly clientSecret: string;
  readonly publishableKey: string;
  readonly connectedAccountId: string;
  readonly amountCents: number;
  readonly merchantName: string;
}

/** El centro que cobra: el cobro se crea en su cuenta de Stripe. */
interface Merchant {
  readonly accountId: string;
  readonly name: string;
}

export interface PaymentConfirmationView {
  readonly paymentId: string;
  readonly status: 'succeeded' | 'pending' | 'failed';
}

function resolveStatus(centerPayments: CenterPaymentsInfo): PaymentsStatus {
  if (!centerPayments.isPremium) return 'not_included';
  if (centerPayments.stripeAccountId === null) return 'not_started';
  return centerPayments.stripeChargesEnabled ? 'ready' : 'pending';
}

@Injectable()
export class PaymentsStatusReader {
  constructor(
    @Inject(PAYMENT_REPOSITORY) private readonly payments: PaymentRepository,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
  ) {}

  /** El centro, con su cuenta de Stripe al día: si ya podía cobrar y aún no constaba, se anota. */
  async readInfo(actor: ActorContext): Promise<CenterPaymentsInfo> {
    const centerPayments = await this.payments.getCenterPaymentsInfo(actor);
    if (!centerPayments) throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
    const accountId = centerPayments.stripeAccountId;
    const isAlreadyUpToDate =
      !centerPayments.isPremium || accountId === null || centerPayments.stripeChargesEnabled;
    if (isAlreadyUpToDate) return centerPayments;
    const account = await this.gateway.readConnectedAccount(accountId);
    if (!account.canCharge) return centerPayments;
    await this.payments.saveChargesEnabled(actor, true);
    return { ...centerPayments, stripeChargesEnabled: true };
  }
}

const PAYMENTS_LIST_LIMIT = 50;

/** Los últimos cobros online del centro, para la administración. */
@Injectable()
export class ListPaymentsUseCase {
  constructor(@Inject(PAYMENT_REPOSITORY) private readonly payments: PaymentRepository) {}

  async execute(actor: ActorContext): Promise<PaymentListItem[]> {
    return this.payments.listPayments(actor, { limit: PAYMENTS_LIST_LIMIT });
  }
}

@Injectable()
export class GetPaymentsStatusUseCase {
  constructor(private readonly statusReader: PaymentsStatusReader) {}

  async execute(actor: ActorContext): Promise<{ status: PaymentsStatus }> {
    return { status: resolveStatus(await this.statusReader.readInfo(actor)) };
  }
}

/** El centro Premium abre su cuenta de cobros en Stripe: el enlace lleva a su formulario de alta. */
@Injectable()
export class StartPaymentsOnboardingUseCase {
  constructor(
    @Inject(PAYMENT_REPOSITORY) private readonly payments: PaymentRepository,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
  ) {}

  async execute(actor: ActorContext): Promise<{ url: string }> {
    const centerPayments = await this.payments.getCenterPaymentsInfo(actor);
    if (!centerPayments) throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
    if (!centerPayments.isPremium)
      throw new DomainError('PAYMENTS_NOT_INCLUDED', HTTP_STATUS.forbidden);
    const accountId =
      centerPayments.stripeAccountId ?? (await this.createAccount(actor, centerPayments));
    return this.gateway.createOnboardingLink(accountId);
  }

  private async createAccount(
    actor: ActorContext,
    centerPayments: CenterPaymentsInfo,
  ): Promise<string> {
    // Stripe exige un email de contacto para abrir la cuenta de cobros.
    if (centerPayments.contactEmail === null) {
      throw new DomainError('CENTER_CONTACT_EMAIL_REQUIRED', HTTP_STATUS.unprocessableEntity);
    }
    const created = await this.gateway.createConnectedAccount({
      centerId: actor.centerId,
      businessName: centerPayments.name,
      contactEmail: centerPayments.contactEmail,
    });
    return this.payments.saveStripeAccount(actor, created.accountId);
  }
}

/** El centro entra en su panel de Stripe (reembolsos y disputas son suyos, no de Yoclick). */
@Injectable()
export class OpenPaymentsDashboardUseCase {
  constructor(
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    private readonly statusReader: PaymentsStatusReader,
  ) {}

  async execute(actor: ActorContext): Promise<{ url: string }> {
    const centerPayments = await this.statusReader.readInfo(actor);
    if (!centerPayments.isPremium)
      throw new DomainError('PAYMENTS_NOT_INCLUDED', HTTP_STATUS.forbidden);
    if (centerPayments.stripeAccountId === null || !centerPayments.stripeChargesEnabled) {
      throw new DomainError('PAYMENTS_NOT_READY', HTTP_STATUS.conflict);
    }
    return this.gateway.createDashboardLink(centerPayments.stripeAccountId);
  }
}

@Injectable()
export class PayTargetUseCase {
  constructor(
    @Inject(PAYMENT_REPOSITORY) private readonly payments: PaymentRepository,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    private readonly statusReader: PaymentsStatusReader,
  ) {}

  /** Prepara el cobro de lo que la persona debe y devuelve lo que la hoja de pago necesita. */
  async execute(actor: ActorContext, target: PaymentTarget): Promise<PaymentSheetView> {
    const centerPayments = await this.statusReader.readInfo(actor);
    if (!centerPayments.isPremium)
      throw new DomainError('PAYMENTS_NOT_INCLUDED', HTTP_STATUS.forbidden);
    if (centerPayments.stripeAccountId === null || !centerPayments.stripeChargesEnabled) {
      throw new DomainError('PAYMENTS_NOT_READY', HTTP_STATUS.conflict);
    }
    const payable = await this.payments.findPayableTarget(actor, target);
    if (!payable) throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
    const merchant = { accountId: centerPayments.stripeAccountId, name: centerPayments.name };
    const sheet = await this.reuseOpenPayment(actor, payable, merchant);
    return sheet ?? this.startPayment(actor, { payable, merchant });
  }

  /** Un intento sin terminar se retoma con su mismo secreto, para no dejar cobros huérfanos. */
  private async reuseOpenPayment(
    actor: ActorContext,
    payable: PayableTarget,
    merchant: Merchant,
  ): Promise<PaymentSheetView | null> {
    const open = await this.payments.findPendingPayment(actor, payable.target);
    if (!open || open.amountCents !== payable.amountCents) return null;
    const gatewayPayment = await this.gateway.readPayment({
      paymentIntentId: open.stripePaymentIntentId,
      accountId: merchant.accountId,
    });
    if (gatewayPayment.status !== 'pending') return null;
    return this.toSheet({
      paymentId: open.id,
      clientSecret: gatewayPayment.clientSecret,
      amountCents: payable.amountCents,
      merchant,
    });
  }

  private async startPayment(
    actor: ActorContext,
    input: { payable: PayableTarget; merchant: Merchant },
  ): Promise<PaymentSheetView> {
    const { payable } = input;
    const paymentId = generateUuidV7();
    const gatewayPayment = await this.gateway.createPayment({
      accountId: input.merchant.accountId,
      amountCents: payable.amountCents,
      description: payable.description,
      idempotencyKey: paymentId,
      metadata: {
        centerId: actor.centerId,
        paymentId,
        kind: payable.target.kind,
        targetId: payable.target.id,
      },
    });
    await this.payments.createPayment(actor, {
      id: paymentId,
      target: payable.target,
      clientMembershipId: payable.clientMembershipId,
      amountCents: payable.amountCents,
      stripePaymentIntentId: gatewayPayment.paymentIntentId,
    });
    return this.toSheet({
      paymentId,
      clientSecret: gatewayPayment.clientSecret,
      amountCents: payable.amountCents,
      merchant: input.merchant,
    });
  }

  private toSheet(input: {
    paymentId: string;
    clientSecret: string;
    amountCents: number;
    merchant: Merchant;
  }): PaymentSheetView {
    return {
      paymentId: input.paymentId,
      clientSecret: input.clientSecret,
      publishableKey: this.gateway.publishableKey,
      connectedAccountId: input.merchant.accountId,
      amountCents: input.amountCents,
      merchantName: input.merchant.name,
    };
  }
}

/** Lee el cobro en la pasarela (la app no es de fiar) y, si Stripe lo dio por pagado, lo liquida. */
@Injectable()
export class SettlePaymentService {
  constructor(
    @Inject(PAYMENT_REPOSITORY) private readonly payments: PaymentRepository,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
  ) {}

  async settleFromGateway(input: {
    centerId: string;
    accountId: string;
    stripePaymentIntentId: string;
  }): Promise<PaymentConfirmationView['status']> {
    const gatewayPayment = await this.gateway.readPayment({
      paymentIntentId: input.stripePaymentIntentId,
      accountId: input.accountId,
    });
    if (gatewayPayment.status !== 'succeeded') return gatewayPayment.status;
    const outcome = await this.payments.settlePayment({
      centerId: input.centerId,
      stripePaymentIntentId: input.stripePaymentIntentId,
      paidAmountCents: gatewayPayment.amountCents,
      now: new Date(),
    });
    return outcome.kind === 'not_found' || outcome.kind === 'amount_mismatch'
      ? 'failed'
      : 'succeeded';
  }
}

@Injectable()
export class ConfirmPaymentUseCase {
  constructor(
    @Inject(PAYMENT_REPOSITORY) private readonly payments: PaymentRepository,
    private readonly settlement: SettlePaymentService,
  ) {}

  async execute(actor: ActorContext, paymentId: string): Promise<PaymentConfirmationView> {
    const payment: PaymentRecord | null = await this.payments.findPaymentOfActor(actor, paymentId);
    if (!payment) throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
    if (payment.status === 'succeeded') return { paymentId, status: 'succeeded' };
    const centerPayments = await this.payments.getCenterPaymentsInfo(actor);
    if (centerPayments?.stripeAccountId == null)
      throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
    const status = await this.settlement.settleFromGateway({
      centerId: actor.centerId,
      accountId: centerPayments.stripeAccountId,
      stripePaymentIntentId: payment.stripePaymentIntentId,
    });
    return { paymentId, status };
  }
}

@Injectable()
export class HandleStripeWebhookUseCase {
  constructor(
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    private readonly settlement: SettlePaymentService,
    @Inject(PAYMENT_REPOSITORY) private readonly payments: PaymentRepository,
  ) {}

  /**
   * Firma válida o error. Solo importan `payment_intent.succeeded` (liquida) y `charge.refunded`
   * (anota la devolución); en ambos casos se relee el cobro en Stripe antes de actuar.
   */
  async execute(input: { rawBody: Buffer; signatureHeader: string | undefined }): Promise<void> {
    const event = this.gateway.verifyWebhook({ ...input, now: new Date() });
    if (event === null) throw new DomainError('BAD_REQUEST', HTTP_STATUS.badRequest);
    const { paymentIntentId, accountId } = event;
    if (paymentIntentId === null || accountId === null) return;
    const isRelevant =
      event.type === 'charge.refunded' || event.type === 'payment_intent.succeeded';
    if (!isRelevant) return;
    const payment = await this.gateway.readPayment({ paymentIntentId, accountId });
    const centerId = payment.metadata['centerId'];
    if (centerId === undefined) return;
    if (event.type === 'charge.refunded') {
      await this.payments.recordRefund({
        centerId,
        stripePaymentIntentId: paymentIntentId,
        refundedCents: payment.refundedCents,
        now: new Date(),
      });
      return;
    }
    await this.settlement.settleFromGateway({
      centerId,
      accountId,
      stripePaymentIntentId: paymentIntentId,
    });
  }
}
