import { Injectable } from '@nestjs/common';
import { v7 as generateUuidV7 } from 'uuid';
import { type Prisma } from '../../../generated/prisma/client';
import {
  TenantPrismaService,
  type TenantTransactionClient,
} from '../../../shared/database/tenant-prisma.service';
import { listPlanFeatures } from '../../../shared/centers/plan-features';
import { MILLISECONDS_PER_DAY } from '../../../shared/time/time-units';
import {
  ENDED_REMINDER_WINDOW_DAYS,
  MAX_REMINDER_LEAD_DAYS,
  type PlanPaymentEmailKind,
} from '../domain/plan-payment-reminders';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { type ClientLoad } from '../domain/client-limit';
import {
  type PlanPriceSpec,
  type SyncedPlan,
  type SyncedVoiceAddonPlan,
  type VoiceAddonPriceSpec,
} from '../application/ports/billing-gateway';
import {
  type BillingCenter,
  type BillingVoiceSubscription,
  type BillingVoiceSubscriptionChanges,
  type BillingRepository,
  type BillingTransaction,
  type CheckoutFacts,
  type NewBillingVoiceSubscription,
  type StripeChargeInput,
  type BillingCenterChanges,
  type CenterClosedNotificationInput,
  type CenterClosureFacts,
  type CenterMemberRef,
  type OwnedCenterRef,
  type PlanNotificationInput,
  type PlanOffer,
  type PlanOwnerContact,
  type PlanStripePrices,
  type TrialReminderCandidate,
  type VoiceAddonTier,
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

function toPlanOffer(plan: Prisma.PlatformPlanGetPayload<object>): PlanOffer {
  return {
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
  };
}

/** El precio fijo del add-on del escalón de ese plan; `null` si `billing:setup` aún no lo ha creado. */
async function findVoiceAddonPriceId(
  client: TenantTransactionClient,
  planId: string,
): Promise<string | null> {
  const tier = await client.voiceAddonPlan.findUnique({
    where: { planId },
    select: { stripeMonthlyPriceId: true, stripeOveragePriceId: true },
  });
  // Sin el precio del exceso, el add-on no se puede completar después: no se ofrece a medias.
  return tier?.stripeOveragePriceId == null ? null : (tier.stripeMonthlyPriceId ?? null);
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

  async readClientLoad(centerId: string): Promise<ClientLoad> {
    const center = await this.client.center.findUniqueOrThrow({
      where: { id: centerId },
      select: { maxClients: true },
    });
    // Misma definición de «cliente activo» que la pantalla de suscripción.
    const activeClientCount = await this.client.membership.count({
      where: { centerId, role: 'client', isStudent: true, status: 'active' },
    });
    return { activeClientCount, maxClients: center.maxClients };
  }

  async notifyOwners(input: PlanNotificationInput): Promise<ActorContext[]> {
    const recipients = await this.client.membership.findMany({
      where: {
        centerId: input.centerId,
        role: { in: input.includeAdmins === true ? ['owner', 'admin'] : ['owner'] },
        status: 'active',
      },
      select: { id: true, userId: true, role: true },
    });
    // `createMany` porque el contexto de cobro puede escribir avisos pero no leerlos.
    await this.client.notification.createMany({
      data: recipients.map((recipient) => ({
        id: generateUuidV7(),
        centerId: input.centerId,
        recipientMembershipId: recipient.id,
        kind: input.kind,
        data: input.data,
      })),
    });
    return recipients.map((recipient) => ({
      userId: recipient.userId,
      centerId: input.centerId,
      membershipId: recipient.id,
      role: recipient.role,
      permissions: [],
    }));
  }

  async listOwnerContacts(centerId: string): Promise<PlanOwnerContact[]> {
    const owners = await this.client.membership.findMany({
      where: { centerId, role: 'owner', status: 'active' },
      orderBy: { createdAt: 'asc' },
      select: { user: { select: { email: true, fullName: true } } },
    });
    return owners.map((owner) => owner.user);
  }

  async findVoiceSubscription(centerId: string): Promise<BillingVoiceSubscription | null> {
    const row = await this.client.voiceReceptionistSubscription.findUnique({ where: { centerId } });
    if (row === null) return null;
    return {
      status: row.status,
      includedMinutes: row.includedMinutes,
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      stripeItemId: row.stripeSubscriptionItemId,
      stripeOverageItemId: row.stripeOverageItemId,
    };
  }

  async updateVoiceSubscription(
    centerId: string,
    changes: BillingVoiceSubscriptionChanges,
  ): Promise<void> {
    await this.client.voiceReceptionistSubscription.update({ where: { centerId }, data: changes });
  }

  async findVoiceAddonTier(planId: string): Promise<VoiceAddonTier | null> {
    const row = await this.client.voiceAddonPlan.findUnique({ where: { planId } });
    if (row === null) return null;
    return {
      planId: row.planId,
      includedMinutes: row.includedMinutes,
      monthlyPriceId: row.stripeMonthlyPriceId,
      overagePriceId: row.stripeOveragePriceId,
    };
  }

  async saveChosenVoiceSubscription(
    centerId: string,
    subscription: NewBillingVoiceSubscription,
  ): Promise<void> {
    const fields = {
      status: 'active' as const,
      includedMinutes: subscription.includedMinutes,
      periodStart: subscription.periodStart,
      periodEnd: subscription.periodEnd,
      stripeSubscriptionItemId: subscription.stripeItemId,
      stripeOverageItemId: subscription.stripeOverageItemId,
    };
    await this.client.voiceReceptionistSubscription.upsert({
      where: { centerId },
      create: { id: generateUuidV7(), centerId, ...fields },
      update: fields,
    });
  }

  async findPlanTaxRateId(planId: string): Promise<string | null> {
    const plan = await this.client.platformPlan.findUnique({
      where: { id: planId },
      select: { stripeTaxRateId: true },
    });
    return plan?.stripeTaxRateId ?? null;
  }

  async isVoiceAddonOffered(): Promise<boolean> {
    const offeredTier = await this.client.voiceAddonPlan.findFirst({
      where: { stripeMonthlyPriceId: { not: null }, stripeOveragePriceId: { not: null } },
      select: { planId: true },
    });
    return offeredTier !== null;
  }

  async listCentersToSweep(now: Date): Promise<BillingCenter[]> {
    const rows = await this.client.center.findMany({
      where: {
        // Un centro cerrado no vuelve a pasar por gracia ni suspensión.
        closedAt: null,
        OR: [
          { status: 'trial', stripeSubscriptionId: null, trialEndsAt: { lte: now } },
          { status: 'past_due', graceEndsAt: { lte: now } },
        ],
      },
    });
    return rows.map(toBillingCenter);
  }

  async listCentersSolelyOwnedBy(userId: string): Promise<OwnedCenterRef[]> {
    const ownerships = await this.client.membership.findMany({
      where: { userId, role: 'owner', status: 'active', center: { closedAt: null } },
      select: { center: { select: { id: true, name: true } } },
    });
    const centerIds = ownerships.map(({ center }) => center.id);
    const otherOwners = await this.client.membership.findMany({
      where: {
        centerId: { in: centerIds },
        role: 'owner',
        status: 'active',
        userId: { not: userId },
      },
      select: { centerId: true },
    });
    const centersWithOtherOwner = new Set(otherOwners.map(({ centerId }) => centerId));
    return ownerships
      .map(({ center }) => ({ centerId: center.id, name: center.name }))
      .filter(({ centerId }) => !centersWithOtherOwner.has(centerId));
  }

  async findCenterForClosure(centerId: string): Promise<CenterClosureFacts | null> {
    return this.client.center.findUnique({
      where: { id: centerId },
      select: { name: true, stripeSubscriptionId: true, closedAt: true },
    });
  }

  async listActiveMembers(centerId: string): Promise<CenterMemberRef[]> {
    const members = await this.client.membership.findMany({
      where: { centerId, status: 'active' },
      select: { id: true, userId: true, role: true },
    });
    return members.map((member) => ({
      membershipId: member.id,
      userId: member.userId,
      role: member.role,
    }));
  }

  async markCenterClosed(centerId: string, closedAt: Date): Promise<void> {
    await this.client.center.update({ where: { id: centerId }, data: { closedAt } });
  }

  async notifyCenterClosed(input: CenterClosedNotificationInput): Promise<void> {
    // `createMany` porque el contexto de cobro puede escribir avisos pero no leerlos.
    await this.client.notification.createMany({
      data: input.recipientMembershipIds.map((recipientMembershipId) => ({
        id: generateUuidV7(),
        centerId: input.centerId,
        recipientMembershipId,
        kind: 'center_closed' as const,
        data: input.data,
      })),
    });
  }

  async endAllMemberships(centerId: string): Promise<void> {
    await this.client.membership.updateMany({
      where: { centerId, status: { not: 'left' } },
      data: { status: 'left' },
    });
  }

  async listTrialReminderCandidates(now: Date): Promise<TrialReminderCandidate[]> {
    const rows = await this.client.center.findMany({
      where: {
        closedAt: null,
        status: { in: ['trial', 'past_due'] },
        stripeSubscriptionId: null,
        trialEndsAt: {
          gt: new Date(now.getTime() - ENDED_REMINDER_WINDOW_DAYS * MILLISECONDS_PER_DAY),
          lte: new Date(now.getTime() + MAX_REMINDER_LEAD_DAYS * MILLISECONDS_PER_DAY),
        },
      },
      include: {
        planPaymentEmails: { select: { kind: true } },
        memberships: {
          where: { role: 'owner', status: 'active' },
          select: { user: { select: { email: true, fullName: true } } },
        },
      },
    });
    return rows.map((row) => ({
      center: toBillingCenter(row),
      owners: row.memberships.map((membership) => membership.user),
      // La columna solo admite los cuatro tipos del CHECK de la migración.
      sentKinds: row.planPaymentEmails.map((sent) => sent.kind as PlanPaymentEmailKind),
    }));
  }

  async listAvailablePlanOffers(): Promise<PlanOffer[]> {
    const plans = await this.client.platformPlan.findMany({ orderBy: { sortOrder: 'asc' } });
    return plans.map(toPlanOffer).filter((offer) => offer.isAvailable);
  }

  async claimPlanPaymentEmail(centerId: string, kind: PlanPaymentEmailKind): Promise<boolean> {
    const result = await this.client.planPaymentEmail.createMany({
      data: [{ centerId, kind }],
      skipDuplicates: true,
    });
    return result.count > 0;
  }

  async findCheckoutFactsForCenter(
    centerId: string,
    planId: string,
  ): Promise<CheckoutFacts | null> {
    const [center, owner, plan] = await Promise.all([
      this.client.center.findUnique({ where: { id: centerId } }),
      this.client.membership.findFirst({
        where: { centerId, role: 'owner', status: 'active' },
        orderBy: { createdAt: 'asc' },
        select: { user: { select: { email: true } } },
      }),
      this.client.platformPlan.findUnique({ where: { id: planId } }),
    ]);
    // Un centro cerrado no puede contratar nada: su enlace de pago deja de funcionar.
    if (center === null || center.closedAt !== null || plan === null) return null;
    return {
      center: toBillingCenter(center),
      ownerEmail: owner?.user.email ?? null,
      planPrices: toPlanPrices(plan),
      voiceAddonPriceId: await findVoiceAddonPriceId(this.client, planId),
    };
  }

  async saveCustomerIdForCenter(centerId: string, customerId: string): Promise<void> {
    await this.client.center.update({
      where: { id: centerId },
      data: { stripeCustomerId: customerId },
    });
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
      return plans.map(toPlanOffer);
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

  async listVoiceAddonSpecs(): Promise<VoiceAddonPriceSpec[]> {
    return this.tenantPrismaService.runInBillingContext(async (client) => {
      const tiers = await client.voiceAddonPlan.findMany({ orderBy: { planId: 'asc' } });
      return tiers.map((tier) => ({
        planId: tier.planId,
        monthlyPriceCents: tier.monthlyPriceCents,
        overageCentsPerMinute: tier.overageCentsPerMinute,
      }));
    });
  }

  async saveVoiceAddonStripeIds(plans: readonly SyncedVoiceAddonPlan[]): Promise<void> {
    await this.tenantPrismaService.runInBillingContext(async (client) => {
      for (const plan of plans) {
        await client.voiceAddonPlan.update({
          where: { planId: plan.planId },
          data: {
            stripeMonthlyPriceId: plan.monthlyPriceId,
            stripeOveragePriceId: plan.overagePriceId,
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
        voiceAddonPriceId: await findVoiceAddonPriceId(client, planId),
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
