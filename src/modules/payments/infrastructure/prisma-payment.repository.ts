import { Injectable } from '@nestjs/common';
import { v7 as generateUuidV7 } from 'uuid';
import {
  TenantPrismaService,
  type TenantTransactionClient,
} from '../../../shared/database/tenant-prisma.service';
import { doesPlanIncludeFeature } from '../../../shared/centers/plan-features';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { computePassExpiry } from '../../passes/domain/pass-rules';
import { buildReceiptNumber } from '../domain/receipt-rules';
import {
  type CenterPaymentsInfo,
  type NewPaymentRecord,
  type PayableTarget,
  type PaymentListItem,
  type PaymentRecord,
  type PaymentRepository,
  type PaymentSettlementOutcome,
  type PaymentTarget,
  type ReceiptView,
} from '../application/ports/payment.repository';

const SELLER_SELECT = { name: true, legalName: true, taxId: true, taxAddress: true } as const;

const PAYMENT_LABEL_INCLUDE = {
  clientMembership: { select: { user: { select: { fullName: true } } } },
  clientPass: { select: { name: true } },
} as const;

/** El nombre del bono que se pagó. */
function describePaymentLabel(payment: { clientPass: { name: string } | null }): string {
  return payment.clientPass?.name ?? '';
}

interface StoredPayment {
  id: string;
  centerId: string;
  clientMembershipId: string;
  status: 'pending' | 'succeeded' | 'failed';
  amountCents: number;
  stripePaymentIntentId: string;
}

function toPaymentRecord(payment: StoredPayment): PaymentRecord {
  return {
    id: payment.id,
    centerId: payment.centerId,
    clientMembershipId: payment.clientMembershipId,
    status: payment.status,
    amountCents: payment.amountCents,
    stripePaymentIntentId: payment.stripePaymentIntentId,
  };
}

function targetWhere(target: PaymentTarget): { clientPassId: string } {
  return { clientPassId: target.id };
}

/** El aviso de Stripe llega sin sesión: se actúa como la administración del centro que dice el cobro. */
function buildSystemActor(centerId: string): ActorContext {
  return { userId: '', centerId, membershipId: '', role: 'owner', permissions: [] };
}

/**
 * El siguiente número de recibo del centro en ese año. Va con un cerrojo por centro: dos cobros que se
 * liquidan a la vez nunca reciben el mismo número ni dejan huecos.
 */
async function assignReceiptNumber(
  client: TenantTransactionClient,
  input: { paymentId: string; centerId: string; paidAt: Date },
): Promise<void> {
  await client.$executeRaw`select pg_advisory_xact_lock(hashtextextended(${input.centerId}, 2))`;
  const year = input.paidAt.getUTCFullYear();
  const issuedThisYear = await client.payment.count({
    where: { centerId: input.centerId, receiptNumber: { startsWith: `${String(year)}-` } },
  });
  await client.payment.update({
    where: { id: input.paymentId },
    data: { receiptNumber: buildReceiptNumber({ year, sequence: issuedThisYear + 1 }) },
  });
}

async function activatePassOfPayment(
  client: TenantTransactionClient,
  input: { passId: string; now: Date },
): Promise<void> {
  const pass = await client.clientPass.findUnique({
    where: { id: input.passId },
    include: { rate: { select: { validDays: true } } },
  });
  if (pass?.status !== 'pending') return;
  // UPDATE condicionado a «sigue pendiente»: el centro pudo validarlo a mano un instante antes.
  const activated = await client.clientPass.updateMany({
    where: { id: pass.id, status: 'pending' },
    data: {
      status: 'active',
      startsAt: input.now,
      expiresAt: computePassExpiry(input.now, pass.rate.validDays),
      decidedAt: input.now,
    },
  });
  if (activated.count === 0) return;
  await client.notification.create({
    data: {
      id: generateUuidV7(),
      centerId: pass.centerId,
      recipientMembershipId: pass.clientMembershipId,
      kind: 'pass_activated',
      data: { rateName: pass.name },
    },
  });
}

/** La administración se entera de cada cobro recibido, con quién pagó y qué. */
async function notifyPaymentReceived(
  client: TenantTransactionClient,
  input: { payment: StoredPayment; now: Date },
): Promise<void> {
  const { payment } = input;
  const detail = await client.payment.findUniqueOrThrow({
    where: { id: payment.id },
    include: PAYMENT_LABEL_INCLUDE,
  });
  const recipients = await client.membership.findMany({
    where: { role: { in: ['owner', 'admin'] }, status: 'active' },
    select: { id: true },
  });
  await client.notification.createMany({
    data: recipients.map(({ id }) => ({
      id: generateUuidV7(),
      centerId: payment.centerId,
      recipientMembershipId: id,
      kind: 'payment_received' as const,
      data: {
        clientName: detail.clientMembership.user.fullName,
        rateName: describePaymentLabel(detail),
        priceCents: String(payment.amountCents),
      },
    })),
  });
}

@Injectable()
export class PrismaPaymentRepository implements PaymentRepository {
  constructor(private readonly tenantPrismaService: TenantPrismaService) {}

  async listPayments(
    actor: ActorContext,
    query: { limit: number; isOnlySucceeded?: boolean },
  ): Promise<PaymentListItem[]> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const payments = await client.payment.findMany({
        // Los cobros de alquileres por bloqueo ya no se crean: los alquileres son clases y se pagan con bono.
        where: { kind: 'pass', ...(query.isOnlySucceeded === true && { status: 'succeeded' }) },
        include: PAYMENT_LABEL_INCLUDE,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit,
      });
      return payments.map((payment) => ({
        id: payment.id,
        kind: 'pass' as const,
        label: describePaymentLabel(payment),
        clientName: payment.clientMembership.user.fullName,
        amountCents: payment.amountCents,
        refundedCents: payment.refundedCents,
        receiptNumber: payment.receiptNumber,
        status: payment.status,
        createdAt: payment.createdAt,
        paidAt: payment.paidAt,
      }));
    });
  }

  async findReceipt(actor: ActorContext, paymentId: string): Promise<ReceiptView | null> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      // La RLS deja a una persona cliente ver solo sus cobros; la administración, los del centro.
      const payment = await client.payment.findFirst({
        where: { id: paymentId, status: 'succeeded', receiptNumber: { not: null } },
        include: { ...PAYMENT_LABEL_INCLUDE, center: { select: SELLER_SELECT } },
      });
      if (payment?.receiptNumber == null || payment.paidAt === null) return null;
      return {
        receiptNumber: payment.receiptNumber,
        issuedAt: payment.paidAt,
        seller: {
          legalName: payment.center.legalName ?? payment.center.name,
          taxId: payment.center.taxId,
          taxAddress: payment.center.taxAddress,
        },
        buyerName: payment.clientMembership.user.fullName,
        concept: describePaymentLabel(payment),
        totalCents: payment.amountCents,
        refundedCents: payment.refundedCents,
      };
    });
  }

  async getCenterPaymentsInfo(actor: ActorContext): Promise<CenterPaymentsInfo | null> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const center = await client.center.findFirst({
        where: { id: actor.centerId },
        select: {
          name: true,
          contactEmail: true,
          planId: true,
          stripeAccountId: true,
          stripeChargesEnabled: true,
          legalName: true,
          taxId: true,
          taxAddress: true,
        },
      });
      if (!center) return null;
      return {
        name: center.name,
        contactEmail: center.contactEmail,
        isPremium: doesPlanIncludeFeature(center.planId, 'onlinePayments'),
        stripeAccountId: center.stripeAccountId,
        stripeChargesEnabled: center.stripeChargesEnabled,
        legalName: center.legalName,
        taxId: center.taxId,
        taxAddress: center.taxAddress,
      };
    });
  }

  async saveStripeAccount(actor: ActorContext, accountId: string): Promise<string> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      await client.center.updateMany({
        where: { id: actor.centerId, stripeAccountId: null },
        data: { stripeAccountId: accountId },
      });
      const center = await client.center.findFirstOrThrow({
        where: { id: actor.centerId },
        select: { stripeAccountId: true },
      });
      return center.stripeAccountId ?? accountId;
    });
  }

  async saveChargesEnabled(actor: ActorContext, canCharge: boolean): Promise<void> {
    await this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      await client.center.updateMany({
        where: { id: actor.centerId },
        data: { stripeChargesEnabled: canCharge },
      });
    });
  }

  async findPayableTarget(
    actor: ActorContext,
    target: PaymentTarget,
  ): Promise<PayableTarget | null> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const pass = await client.clientPass.findFirst({
        where: { id: target.id, status: 'pending', clientMembershipId: actor.membershipId },
      });
      if (!pass || pass.priceCents <= 0) return null;
      return {
        target,
        amountCents: pass.priceCents,
        description: pass.name,
        clientMembershipId: pass.clientMembershipId,
      };
    });
  }

  async findPendingPayment(
    actor: ActorContext,
    target: PaymentTarget,
  ): Promise<PaymentRecord | null> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const payment = await client.payment.findFirst({
        where: { ...targetWhere(target), status: 'pending' },
        orderBy: { createdAt: 'desc' },
      });
      return payment ? toPaymentRecord(payment) : null;
    });
  }

  async createPayment(actor: ActorContext, payment: NewPaymentRecord): Promise<PaymentRecord> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const created = await client.payment.create({
        data: {
          id: payment.id,
          centerId: actor.centerId,
          clientMembershipId: payment.clientMembershipId,
          kind: payment.target.kind,
          ...targetWhere(payment.target),
          amountCents: payment.amountCents,
          stripePaymentIntentId: payment.stripePaymentIntentId,
        },
      });
      return toPaymentRecord(created);
    });
  }

  async findPaymentOfActor(actor: ActorContext, paymentId: string): Promise<PaymentRecord | null> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const payment = await client.payment.findFirst({
        where: { id: paymentId, clientMembershipId: actor.membershipId },
      });
      return payment ? toPaymentRecord(payment) : null;
    });
  }

  async recordRefund(command: {
    centerId: string;
    stripePaymentIntentId: string;
    refundedCents: number;
    now: Date;
  }): Promise<void> {
    const systemActor = buildSystemActor(command.centerId);
    await this.tenantPrismaService.runInTenantContext(systemActor, async (client) => {
      const payment = await client.payment.findUnique({
        where: { stripePaymentIntentId: command.stripePaymentIntentId },
      });
      if (payment?.centerId !== command.centerId || payment.status !== 'succeeded') return;
      const refundedCents = Math.min(
        Math.max(command.refundedCents, payment.refundedCents),
        payment.amountCents,
      );
      await client.payment.update({ where: { id: payment.id }, data: { refundedCents } });
      if (refundedCents < payment.amountCents || payment.clientPassId === null) return;
      // Devolución total: el bono ya no vale (mismo efecto que «quitar bono» en la administración)
      // y queda anotado el momento, para bloquear las citas anteriores hasta tener un bono nuevo.
      await client.clientPass.updateMany({
        where: { id: payment.clientPassId, status: { not: 'cancelled' } },
        data: { status: 'cancelled', decidedAt: command.now },
      });
      await client.clientPass.updateMany({
        where: { id: payment.clientPassId, refundedAt: null },
        data: { refundedAt: command.now },
      });
    });
  }

  async settlePayment(command: {
    centerId: string;
    stripePaymentIntentId: string;
    paidAmountCents: number;
    now: Date;
  }): Promise<PaymentSettlementOutcome> {
    const systemActor = buildSystemActor(command.centerId);
    return this.tenantPrismaService.runInTenantContext(systemActor, async (client) => {
      const payment = await client.payment.findUnique({
        where: { stripePaymentIntentId: command.stripePaymentIntentId },
      });
      if (!payment || payment.centerId !== command.centerId) return { kind: 'not_found' };
      if (payment.status === 'succeeded') {
        return { kind: 'already_settled', payment: toPaymentRecord(payment) };
      }
      if (payment.amountCents !== command.paidAmountCents) return { kind: 'amount_mismatch' };
      // Condicionado a «sigue pendiente»: la app y el aviso de Stripe pueden llegar a la vez.
      const marked = await client.payment.updateMany({
        where: { id: payment.id, status: { not: 'succeeded' } },
        data: { status: 'succeeded', paidAt: command.now },
      });
      if (marked.count === 0) return { kind: 'already_settled', payment: toPaymentRecord(payment) };
      await assignReceiptNumber(client, {
        paymentId: payment.id,
        centerId: payment.centerId,
        paidAt: command.now,
      });
      if (payment.clientPassId !== null) {
        await activatePassOfPayment(client, { passId: payment.clientPassId, now: command.now });
      }
      await notifyPaymentReceived(client, { payment, now: command.now });
      return { kind: 'settled', payment: toPaymentRecord({ ...payment, status: 'succeeded' }) };
    });
  }
}
