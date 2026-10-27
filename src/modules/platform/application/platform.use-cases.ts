import { Inject, Injectable } from '@nestjs/common';
import { type PlatformActorContext } from '../../../shared/auth/authenticated-request';
import { DomainError } from '../../../shared/errors/domain-error';
import { HTTP_STATUS } from '../../../shared/errors/http-status';
import { type Page } from '../../../shared/pagination/build-page';
import {
  buildChargesCsv,
  canChargeBeChanged,
  computeChargeAmounts,
  describeChargeChanges,
  isChargeDayAcceptable,
  isReportRangeValid,
  summarizeChargesByMonth,
  sumMonthlySummaries,
  type ChargeChanges,
  type ChargeStatus,
  type MonthlyChargeSummary,
  type PaymentMethod,
} from '../domain/charge-rules';
import { describeCenterChanges, isValidTrialEnd } from '../domain/center-changes';
import {
  applyPlanPriceChanges,
  arePlanPricesValid,
  computeMonthlyRecurringRevenueCents,
  describePlanPriceChanges,
  type PlanPriceChanges,
} from '../domain/plan-rules';
import {
  PLATFORM_CHARGE_REPOSITORY,
  PLATFORM_PLAN_REPOSITORY,
  PLATFORM_REPOSITORY,
  type AuditListQuery,
  type ChargeListQuery,
  type ChargeReportRange,
  type CenterChanges,
  type CenterListQuery,
  type PlatformAuditEntry,
  type PlatformCharge,
  type PlatformChargeRepository,
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

export interface ChargeReport {
  readonly months: readonly MonthlyChargeSummary[];
  readonly totals: Omit<MonthlyChargeSummary, 'month'>;
}

@Injectable()
export class ListPlatformChargesUseCase {
  constructor(
    @Inject(PLATFORM_CHARGE_REPOSITORY) private readonly charges: PlatformChargeRepository,
  ) {}

  execute(actor: PlatformActorContext, query: ChargeListQuery): Promise<Page<PlatformCharge>> {
    return this.charges.listCharges(actor, query);
  }
}

export interface RecordChargeInput {
  readonly centerId: string;
  readonly chargedOn: string;
  readonly concept: string;
  readonly baseCents: number;
  readonly vatBasisPoints: number;
  readonly status: ChargeStatus;
  readonly paymentMethod: PaymentMethod;
  readonly invoiceReference: string | null;
  readonly customerLegalName: string | null;
  readonly customerTaxId: string | null;
}

/** Apunta a mano un cobro de plan (los primeros pilotos) con su IVA calculado y lo deja en la auditoría. */
@Injectable()
export class RecordPlatformChargeUseCase {
  constructor(
    @Inject(PLATFORM_CHARGE_REPOSITORY) private readonly charges: PlatformChargeRepository,
  ) {}

  async execute(actor: PlatformActorContext, input: RecordChargeInput): Promise<PlatformCharge> {
    if (!isChargeDayAcceptable(input.chargedOn, new Date())) {
      throw new DomainError('BAD_REQUEST', HTTP_STATUS.badRequest);
    }
    const amounts = computeChargeAmounts(input);
    const created = await this.charges.createCharge({
      actor,
      charge: { ...input, ...amounts },
      auditEntries: [
        {
          action: 'charge_recorded',
          details: { concept: input.concept, totalCents: amounts.totalCents, status: input.status },
        },
      ],
    });
    if (created === null) throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
    return created;
  }
}

/** Cambia el estado de un cobro o su referencia de factura; un cobro anulado ya no se toca. */
@Injectable()
export class UpdatePlatformChargeUseCase {
  constructor(
    @Inject(PLATFORM_CHARGE_REPOSITORY) private readonly charges: PlatformChargeRepository,
  ) {}

  async execute(
    actor: PlatformActorContext,
    chargeId: string,
    changes: ChargeChanges,
  ): Promise<PlatformCharge> {
    const current = await this.charges.findCharge(actor, chargeId);
    if (current === null) throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
    if (!canChargeBeChanged(current)) throw new DomainError('CONFLICT', HTTP_STATUS.conflict);

    const auditEntries = describeChargeChanges(chargeId, current, changes);
    if (auditEntries.length > 0) {
      const wasUpdated = await this.charges.updateCharge({
        actor,
        chargeId,
        changes,
        auditEntries,
      });
      if (!wasUpdated) throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
    }
    const updated = await this.charges.findCharge(actor, chargeId);
    if (updated === null) throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
    return updated;
  }
}

/** Lo cobrado mes a mes y el total del rango: la base y el IVA que el gestor lleva a su declaración. */
@Injectable()
export class GetPlatformChargeReportUseCase {
  constructor(
    @Inject(PLATFORM_CHARGE_REPOSITORY) private readonly charges: PlatformChargeRepository,
  ) {}

  async execute(actor: PlatformActorContext, range: ChargeReportRange): Promise<ChargeReport> {
    if (!isReportRangeValid(range)) throw new DomainError('BAD_REQUEST', HTTP_STATUS.badRequest);
    const charges = await this.charges.listChargesInRange(actor, range);
    const months = summarizeChargesByMonth(charges);
    return { months, totals: sumMonthlySummaries(months) };
  }
}

@Injectable()
export class ExportPlatformChargesCsvUseCase {
  constructor(
    @Inject(PLATFORM_CHARGE_REPOSITORY) private readonly charges: PlatformChargeRepository,
  ) {}

  async execute(actor: PlatformActorContext, range: ChargeReportRange): Promise<string> {
    if (!isReportRangeValid(range)) throw new DomainError('BAD_REQUEST', HTTP_STATUS.badRequest);
    const charges = await this.charges.listChargesInRange(actor, range);
    return buildChargesCsv(charges);
  }
}
