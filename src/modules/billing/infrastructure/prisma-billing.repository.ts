import { Injectable } from '@nestjs/common';
import { v7 as generateUuidV7 } from 'uuid';
import { type Prisma } from '../../../generated/prisma/client';
import {
  TenantPrismaService,
  type TenantTransactionClient,
} from '../../../shared/database/tenant-prisma.service';
import { listPlanFeatures } from '../../../shared/centers/plan-features';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { type PlanPriceSpec, type SyncedPlan } from '../application/ports/billing-gateway';
import {
  type BillingCenter,
  type BillingRepository,
  type BillingTransaction,
  type CheckoutFacts,
  type StripeChargeInput,
  type BillingCenterChanges,
  type PlanNotificationInput,
  type PlanOffer,
  type PlanStripePrices,
} from '../application/ports/billing.repository';

type CenterRow = Prisma.CenterGetPayload<object>;

function toBillingCenter(row: CenterRow): BillingCenter {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    planId: row.planId,
    trialEndsAt: row.trialEndsAt,
    graceEndsAt: row.graceEndsAt,
    stripeCustomerId: row.stripeCustomerId,
    stripeSubscriptionId: row.stripeSubscriptionId,
  };
}

/** Al asignar un plan, el centro recibe sus límites (docs/spec/17 §2.1). */
async function readPlanLimits(
  client: TenantTransactionClient,
  planId: string | undefined,
): Promise<Prisma.CenterUncheckedUpdateManyInput> {
  if (planId === undefined) return {};
  const plan = await client.platformPlan.findUniqueOrThrow({ where: { id: planId } });
  return {
    planId: plan.id,
    maxClients: plan.maxClients,
    documentStorageLimitBytes: plan.documentStorageLimitBytes,
    videoStorageLimitBytes: plan.videoStorageLimitBytes,
  };
}

/** Los ids de Stripe del plan; `null` mientras `billing:setup` no los haya creado. */
function toPlanPrices(plan: Prisma.PlatformPlanGetPayload<object>): PlanStripePrices | null {
  const { stripeMonthlyPriceId, stripeAnnualPriceId, stripeTaxRateId } = plan;
  if (stripeMonthlyPriceId === null || stripeAnnualPriceId === null || stripeTaxRateId === null) {
    return null;
  }
  return {
    monthlyPriceId: stripeMonthlyPriceId,
    annualPriceId: stripeAnnualPriceId,
    setupFeePriceId: plan.stripeSetupFeePriceId,
    taxRateId: stripeTaxRateId,
  };
}

class PrismaBillingTransaction implements BillingTransaction {
  constructor(private readonly client: TenantTransactionClient) {}

  async markEventAsNew(eventId: string, eventType: string): Promise<boolean> {
    const result = await this.client.platformWebhookEvent.createMany({
      data: [{ id: eventId, type: eventType }],
      skipDuplicates: true,
    });
    return result.count > 0;
  }

  async findCenterById(centerId: string): Promise<BillingCenter | null> {
    const row = await this.client.center.findUnique({ where: { id: centerId } });
    return row === null ? null : toBillingCenter(row);
  }

  async findCenterByCustomerId(customerId: string): Promise<BillingCenter | null> {
    const row = await this.client.center.findUnique({ where: { stripeCustomerId: customerId } });
    return row === null ? null : toBillingCenter(row);
  }

  async updateCenter(centerId: string, changes: BillingCenterChanges): Promise<void> {
    const { planId, ...rest } = changes;
    await this.client.center.update({
      where: { id: centerId },
      data: { ...rest, ...(await readPlanLimits(this.client, planId)) },
    });
  }

  async recordStripeCharge(charge: StripeChargeInput): Promise<void> {
    await this.client.platformCharge.createMany({
      data: [
        {
          id: generateUuidV7(),
          centerId: charge.centerId,
          chargedOn: charge.chargedOn,
          concept: charge.concept,
          baseCents: charge.baseCents,
          vatBasisPoints: charge.vatBasisPoints,
          vatCents: charge.vatCents,
          totalCents: charge.totalCents,
          status: 'paid',
          source: 'stripe',
          paymentMethod: 'card',
          invoiceReference: charge.invoiceReference,
          stripeId: charge.stripeInvoiceId,
        },
      ],
      skipDuplicates: true,
    });
  }

  async writeAudit(input: {
    centerId: string;
    action: string;
    details: Readonly<Record<string, unknown>>;
  }): Promise<void> {
    // `createMany` no devuelve la fila: el contexto de cobro puede escribir en la auditoría, no leerla.
    await this.client.platformAuditEntry.createMany({
      data: [
        {
          id: generateUuidV7(),
          centerId: input.centerId,
          action: input.action,
          details: input.details as Prisma.InputJsonObject,
        },
      ],
    });
  }

  async notifyOwners(input: PlanNotificationInput): Promise<ActorContext[]> {
    const owners = await this.client.membership.findMany({
      where: { centerId: input.centerId, role: 'owner', status: 'active' },
      select: { id: true, userId: true },
    });
    // `createMany` porque el contexto de cobro puede escribir avisos pero no leerlos.
    await this.client.notification.createMany({
      data: owners.map((owner) => ({
        id: generateUuidV7(),
        centerId: input.centerId,
        recipientMembershipId: owner.id,
        kind: input.kind,
        data: input.data,
      })),
    });
    return owners.map((owner) => ({
      userId: owner.userId,
      centerId: input.centerId,
      membershipId: owner.id,
      role: 'owner',
      permissions: [],
    }));
  }

  async listCentersToSweep(now: Date): Promise<BillingCenter[]> {
    const rows = await this.client.center.findMany({
      where: {
        OR: [
          { status: 'trial', stripeSubscriptionId: null, trialEndsAt: { lte: now } },
          { status: 'past_due', graceEndsAt: { lte: now } },
        ],
      },
    });
    return rows.map(toBillingCenter);
  }
}

@Injectable()
export class PrismaBillingRepository implements BillingRepository {
  constructor(private readonly tenantPrismaService: TenantPrismaService) {}

  runInTransaction<TResult>(
    work: (transaction: BillingTransaction) => Promise<TResult>,
  ): Promise<TResult> {
    return this.tenantPrismaService.runInBillingContext((client) =>
      work(new PrismaBillingTransaction(client)),
    );
  }

  async listPlanOffers(actor: ActorContext): Promise<PlanOffer[]> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const plans = await client.platformPlan.findMany({ orderBy: { sortOrder: 'asc' } });
      return plans.map((plan) => ({
        id: plan.id,
        name: plan.name,
        monthlyPriceCents: plan.monthlyPriceCents,
        annualMonthlyPriceCents: plan.annualMonthlyPriceCents,
        setupFeeCents: plan.setupFeeCents,
        maxClients: plan.maxClients,
        documentStorageLimitBytes: Number(plan.documentStorageLimitBytes),
        videoStorageLimitBytes:
          plan.videoStorageLimitBytes === null ? null : Number(plan.videoStorageLimitBytes),
        features: listPlanFeatures(plan.id),
        isAvailable: toPlanPrices(plan) !== null,
      }));
    });
  }

  async listPlanSpecs(): Promise<PlanPriceSpec[]> {
    return this.tenantPrismaService.runInBillingContext(async (client) => {
      const plans = await client.platformPlan.findMany({ orderBy: { sortOrder: 'asc' } });
      return plans.map((plan) => ({
        planId: plan.id,
        name: plan.name,
        monthlyPriceCents: plan.monthlyPriceCents,
        annualMonthlyPriceCents: plan.annualMonthlyPriceCents,
        setupFeeCents: plan.setupFeeCents,
      }));
    });
  }

  async savePlanStripeIds(plans: readonly SyncedPlan[]): Promise<void> {
    await this.tenantPrismaService.runInBillingContext(async (client) => {
      for (const plan of plans) {
        await client.platformPlan.update({
          where: { id: plan.planId },
          data: {
            stripeProductId: plan.productId,
            stripeMonthlyPriceId: plan.monthlyPriceId,
            stripeAnnualPriceId: plan.annualPriceId,
            stripeSetupFeePriceId: plan.setupFeePriceId,
            stripeTaxRateId: plan.taxRateId,
          },
        });
      }
    });
  }

  async findCheckoutFacts(actor: ActorContext, planId: string): Promise<CheckoutFacts | null> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const [center, owner, plan] = await Promise.all([
        client.center.findUnique({ where: { id: actor.centerId } }),
        client.user.findUnique({ where: { id: actor.userId } }),
        client.platformPlan.findUnique({ where: { id: planId } }),
      ]);
      if (center === null || plan === null) return null;
      return {
        center: toBillingCenter(center),
        ownerEmail: owner?.email ?? null,
        planPrices: toPlanPrices(plan),
      };
    });
  }

  async findCustomerId(actor: ActorContext): Promise<string | null> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const center = await client.center.findUnique({
        where: { id: actor.centerId },
        select: { stripeCustomerId: true },
      });
      return center?.stripeCustomerId ?? null;
    });
  }

  async saveCustomerId(actor: ActorContext, customerId: string): Promise<void> {
    await this.tenantPrismaService.runInTenantContext(actor, (client) =>
      client.center.update({
        where: { id: actor.centerId },
        data: { stripeCustomerId: customerId },
      }),
    );
  }
}
