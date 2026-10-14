import { Injectable } from '@nestjs/common';
import { v7 as generateUuidV7 } from 'uuid';
import {
  TenantPrismaService,
  type TenantTransactionClient,
} from '../../../shared/database/tenant-prisma.service';
import { isPremiumPlan } from '../../../shared/centers/center-appearance';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { computePassExpiry } from '../../passes/domain/pass-rules';
import {
  type CenterPaymentsInfo,
  type NewPaymentRecord,
  type PayableTarget,
  type PaymentListItem,
  type PaymentRecord,
  type PaymentRepository,
  type PaymentSettlementOutcome,
  type PaymentTarget,
} from '../application/ports/payment.repository';

const PAYMENT_LABEL_INCLUDE = {
  clientMembership: { select: { user: { select: { fullName: true } } } },
  clientPass: { select: { name: true } },
  roomBlock: { select: { room: { select: { name: true } } } },
} as const;

/** El nombre del bono o de la sala que se pagó. */
function describePaymentLabel(payment: {
  clientPass: { name: string } | null;
  roomBlock: { room: { name: string } } | null;
}): string {
  return payment.clientPass?.name ?? payment.roomBlock?.room.name ?? '';
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

function targetWhere(target: PaymentTarget): { clientPassId: string } | { roomBlockId: string } {
  return target.kind === 'pass' ? { clientPassId: target.id } : { roomBlockId: target.id };
}

/** El aviso de Stripe llega sin sesión: se actúa como la administración del centro que dice el cobro. */
function buildSystemActor(centerId: string): ActorContext {
  return { userId: '', centerId, membershipId: '', role: 'owner', permissions: [] };
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

  async listPayments(actor: ActorContext, query: { limit: number }): Promise<PaymentListItem[]> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const payments = await client.payment.findMany({
        include: PAYMENT_LABEL_INCLUDE,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit,
      });
      return payments.map((payment) => ({
        id: payment.id,
        kind: payment.kind,
        label: describePaymentLabel(payment),
        clientName: payment.clientMembership.user.fullName,
        amountCents: payment.amountCents,
        status: payment.status,
        createdAt: payment.createdAt,
        paidAt: payment.paidAt,
      }));
    });
  }

  async getCenterPaymentsInfo(actor: ActorContext): Promise<CenterPaymentsInfo | null> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const center = await client.center.findFirst({
        where: { id: actor.centerId },
        select: {
          name: true,
          contactEmail: true,
          maxClients: true,
          stripeAccountId: true,
          stripeChargesEnabled: true,
        },
      });
      if (!center) return null;
      return {
        name: center.name,
        contactEmail: center.contactEmail,
        isPremium: isPremiumPlan(center.maxClients),
        stripeAccountId: center.stripeAccountId,
        stripeChargesEnabled: center.stripeChargesEnabled,
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
      if (target.kind === 'pass') {
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
      }
      const block = await client.roomBlock.findFirst({
        where: {
          id: target.id,
          renterMembershipId: actor.membershipId,
          priceCents: { not: null },
          payments: { none: { status: 'succeeded' } },
        },
        include: { room: { select: { name: true } } },
      });
      if (!block || block.priceCents === null || block.renterMembershipId === null) return null;
      return {
        target,
        amountCents: block.priceCents,
        description: block.room.name,
        clientMembershipId: block.renterMembershipId,
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
      if (payment.clientPassId !== null) {
        await activatePassOfPayment(client, { passId: payment.clientPassId, now: command.now });
      }
      await notifyPaymentReceived(client, { payment, now: command.now });
      return { kind: 'settled', payment: toPaymentRecord({ ...payment, status: 'succeeded' }) };
    });
  }
}
