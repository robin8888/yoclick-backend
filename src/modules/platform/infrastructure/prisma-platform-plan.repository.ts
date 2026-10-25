import { Injectable } from '@nestjs/common';
import { v7 as generateUuidV7 } from 'uuid';
import { type Prisma } from '../../../generated/prisma/client';
import { type PlatformActorContext } from '../../../shared/auth/authenticated-request';
import {
  TenantPrismaService,
  type TenantTransactionClient,
} from '../../../shared/database/tenant-prisma.service';
import {
  type CenterStatus,
  type PlanPriceUpdate,
  type PlatformPlanRepository,
  type PlatformPlanSummary,
} from '../application/ports/platform.repository';

const CENTER_STATUSES: readonly CenterStatus[] = ['trial', 'active', 'past_due', 'suspended'];

type PlanRow = Prisma.PlatformPlanGetPayload<object>;

function toPlanSummary(
  plan: PlanRow,
  countsByStatus: ReadonlyMap<string, number>,
): PlatformPlanSummary {
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
    centerCountByStatus: Object.fromEntries(
      CENTER_STATUSES.map((status) => [status, countsByStatus.get(`${plan.id}:${status}`) ?? 0]),
    ) as Record<CenterStatus, number>,
  };
}

/** Cuántos centros hay de cada plan y estado: agregados, nunca datos de personas. */
async function countCentersByPlanAndStatus(
  client: TenantTransactionClient,
): Promise<Map<string, number>> {
  const rows = await client.center.groupBy({
    by: ['planId', 'status'],
    _count: { _all: true },
  });
  return new Map(rows.map((row) => [`${row.planId}:${row.status}`, row._count._all]));
}

@Injectable()
export class PrismaPlatformPlanRepository implements PlatformPlanRepository {
  constructor(private readonly tenantPrismaService: TenantPrismaService) {}

  async listPlans(actor: PlatformActorContext): Promise<PlatformPlanSummary[]> {
    return this.tenantPrismaService.runInPlatformContext(actor, async (client) => {
      const [plans, counts] = await Promise.all([
        client.platformPlan.findMany({ orderBy: { sortOrder: 'asc' } }),
        countCentersByPlanAndStatus(client),
      ]);
      return plans.map((plan) => toPlanSummary(plan, counts));
    });
  }

  async findPlan(actor: PlatformActorContext, planId: string): Promise<PlatformPlanSummary | null> {
    const plans = await this.listPlans(actor);
    return plans.find((plan) => plan.id === planId) ?? null;
  }

  async updatePlanPrices(update: PlanPriceUpdate): Promise<boolean> {
    const { actor, planId, changes, auditEntries } = update;
    return this.tenantPrismaService.runInPlatformContext(actor, async (client) => {
      const result = await client.platformPlan.updateMany({
        where: { id: planId },
        data: {
          ...(changes.monthlyPriceCents === undefined
            ? {}
            : { monthlyPriceCents: changes.monthlyPriceCents }),
          ...(changes.annualMonthlyPriceCents === undefined
            ? {}
            : { annualMonthlyPriceCents: changes.annualMonthlyPriceCents }),
          ...(changes.setupFeeCents === undefined ? {} : { setupFeeCents: changes.setupFeeCents }),
        },
      });
      if (result.count === 0) return false;
      await client.platformAuditEntry.createMany({
        data: auditEntries.map((entry) => ({
          id: generateUuidV7(),
          actorUserId: actor.userId,
          action: entry.action,
          details: entry.details as Prisma.InputJsonObject,
        })),
      });
      return true;
    });
  }
}
