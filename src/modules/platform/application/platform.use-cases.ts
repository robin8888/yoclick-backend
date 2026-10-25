import { Inject, Injectable } from '@nestjs/common';
import { type PlatformActorContext } from '../../../shared/auth/authenticated-request';
import { DomainError } from '../../../shared/errors/domain-error';
import { HTTP_STATUS } from '../../../shared/errors/http-status';
import { type Page } from '../../../shared/pagination/build-page';
import { describeCenterChanges, isValidTrialEnd } from '../domain/center-changes';
import {
  applyPlanPriceChanges,
  arePlanPricesValid,
  computeMonthlyRecurringRevenueCents,
  describePlanPriceChanges,
  type PlanPriceChanges,
} from '../domain/plan-rules';
import {
  PLATFORM_PLAN_REPOSITORY,
  PLATFORM_REPOSITORY,
  type AuditListQuery,
  type CenterChanges,
  type CenterListQuery,
  type PlatformAuditEntry,
  type PlatformCenterDetail,
  type PlatformCenterSummary,
  type PlatformOverview,
  type PlatformPlanRepository,
  type PlatformPlanSummary,
  type PlatformRepository,
} from './ports/platform.repository';

@Injectable()
export class GetPlatformOverviewUseCase {
  constructor(@Inject(PLATFORM_REPOSITORY) private readonly platform: PlatformRepository) {}

  execute(actor: PlatformActorContext): Promise<PlatformOverview> {
    return this.platform.getOverview(actor, new Date());
  }
}

@Injectable()
export class ListPlatformCentersUseCase {
  constructor(@Inject(PLATFORM_REPOSITORY) private readonly platform: PlatformRepository) {}

  execute(
    actor: PlatformActorContext,
    query: CenterListQuery,
  ): Promise<Page<PlatformCenterSummary>> {
    return this.platform.listCenters(actor, query, new Date());
  }
}

@Injectable()
export class GetPlatformCenterUseCase {
  constructor(@Inject(PLATFORM_REPOSITORY) private readonly platform: PlatformRepository) {}

  async execute(actor: PlatformActorContext, centerId: string): Promise<PlatformCenterDetail> {
    const center = await this.platform.findCenter(actor, centerId, new Date());
    if (center === null) throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
    return center;
  }
}

/** Cambia el estado, el fin de la prueba o el tope de clientes de un centro y lo deja en la auditoría. */
@Injectable()
export class UpdatePlatformCenterUseCase {
  constructor(
    @Inject(PLATFORM_REPOSITORY) private readonly platform: PlatformRepository,
    @Inject(PLATFORM_PLAN_REPOSITORY) private readonly plans: PlatformPlanRepository,
  ) {}

  async execute(
    actor: PlatformActorContext,
    centerId: string,
    changes: CenterChanges,
  ): Promise<PlatformCenterDetail> {
    const now = new Date();
    if (
      changes.planId !== undefined &&
      (await this.plans.findPlan(actor, changes.planId)) === null
    ) {
      throw new DomainError('BAD_REQUEST', HTTP_STATUS.badRequest);
    }
    if (changes.trialEndsAt !== undefined && !isValidTrialEnd(changes.trialEndsAt, now)) {
      throw new DomainError('BAD_REQUEST', HTTP_STATUS.badRequest);
    }
    const current = await this.platform.findCenter(actor, centerId, now);
    if (current === null) throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);

    const auditEntries = describeCenterChanges(current, changes);
    if (auditEntries.length > 0) {
      const wasUpdated = await this.platform.updateCenter({
        actor,
        centerId,
        changes,
        auditEntries,
      });
      if (!wasUpdated) throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
    }
    const updated = await this.platform.findCenter(actor, centerId, now);
    if (updated === null) throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
    return updated;
  }
}

@Injectable()
export class ListPlatformAuditUseCase {
  constructor(@Inject(PLATFORM_REPOSITORY) private readonly platform: PlatformRepository) {}

  execute(actor: PlatformActorContext, query: AuditListQuery): Promise<Page<PlatformAuditEntry>> {
    return this.platform.listAuditEntries(actor, query);
  }
}

export interface PlatformPlansView {
  readonly plans: readonly PlatformPlanSummary[];
  /** Ingresos recurrentes al mes (sin IVA) de los centros que pagan: activos y en gracia. */
  readonly monthlyRecurringRevenueCents: number;
}

@Injectable()
export class ListPlatformPlansUseCase {
  constructor(@Inject(PLATFORM_PLAN_REPOSITORY) private readonly plans: PlatformPlanRepository) {}

  async execute(actor: PlatformActorContext): Promise<PlatformPlansView> {
    const plans = await this.plans.listPlans(actor);
    return {
      plans,
      monthlyRecurringRevenueCents: computeMonthlyRecurringRevenueCents(
        plans.map((plan) => ({
          monthlyPriceCents: plan.monthlyPriceCents,
          payingCenterCount: plan.centerCountByStatus.active + plan.centerCountByStatus.past_due,
        })),
      ),
    };
  }
}

/** Cambia el precio mensual, el anual o la cuota de alta de un plan y lo deja en la auditoría. */
@Injectable()
export class UpdatePlatformPlanPricesUseCase {
  constructor(@Inject(PLATFORM_PLAN_REPOSITORY) private readonly plans: PlatformPlanRepository) {}

  async execute(
    actor: PlatformActorContext,
    planId: string,
    changes: PlanPriceChanges,
  ): Promise<PlatformPlanSummary> {
    const current = await this.plans.findPlan(actor, planId);
    if (current === null) throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
    if (!arePlanPricesValid(applyPlanPriceChanges(current, changes))) {
      throw new DomainError('BAD_REQUEST', HTTP_STATUS.badRequest);
    }
    const auditEntries = describePlanPriceChanges(planId, current, changes);
    if (auditEntries.length > 0) {
      const wasUpdated = await this.plans.updatePlanPrices({
        actor,
        planId,
        changes,
        auditEntries,
      });
      if (!wasUpdated) throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
    }
    const updated = await this.plans.findPlan(actor, planId);
    if (updated === null) throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
    return updated;
  }
}
