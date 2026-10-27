import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CenterPlanFinder } from '../../centers/center-plan.finder';
import { isPlanRequired } from '../../centers/plan-access';
import { doesPlanIncludeFeature, type PlanFeatureId } from '../../centers/plan-features';
import { DomainError } from '../../errors/domain-error';
import { HTTP_STATUS } from '../../errors/http-status';
import { type AuthenticatedRequest } from '../authenticated-request';
import {
  ALLOW_WITHOUT_PLAN_ROUTE_KEY,
  REQUIRED_PLAN_FEATURE_ROUTE_KEY,
} from '../decorators/requires-plan-feature.decorator';

const READ_ONLY_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);
const MANAGER_ROLES: ReadonlySet<string> = new Set(['owner', 'admin']);

/**
 * Quinto guard: el plan del centro. (1) Una ruta con `@RequiresPlanFeature()` solo funciona si el
 * plan incluye esa función. (2) Si el centro debe contratar un plan (prueba acabada, impago sin
 * gracia, suspendido), quien lo administra no puede cambiar nada hasta que lo contrate; leer sí,
 * y las personas del centro siguen con lo suyo.
 */
@Injectable()
export class PlanGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly centerPlanFinder: CenterPlanFinder,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const { actor } = request;
    if (actor === undefined) return true;

    const requiredFeature = this.readRequiredFeature(context);
    const isSubjectToPlanRequirement = this.isSubjectToPlanRequirement(context, request);
    if (requiredFeature === undefined && !isSubjectToPlanRequirement) return true;

    const plan = await this.centerPlanFinder.find(actor.centerId);
    if (plan === null) return true;
    if (requiredFeature !== undefined && !doesPlanIncludeFeature(plan.planId, requiredFeature)) {
      throw new DomainError('PLAN_FEATURE_NOT_INCLUDED', HTTP_STATUS.paymentRequired);
    }
    if (isSubjectToPlanRequirement && isPlanRequired(plan, new Date())) {
      throw new DomainError('PLAN_REQUIRED', HTTP_STATUS.paymentRequired);
    }
    return true;
  }

  private readRequiredFeature(context: ExecutionContext): PlanFeatureId | undefined {
    return this.reflector.getAllAndOverride<PlanFeatureId | undefined>(
      REQUIRED_PLAN_FEATURE_ROUTE_KEY,
      [context.getHandler(), context.getClass()],
    );
  }

  /** Un cambio de quien administra el centro, en una ruta que no sirve para contratar el plan. */
  private isSubjectToPlanRequirement(
    context: ExecutionContext,
    request: AuthenticatedRequest,
  ): boolean {
    const isAllowedWithoutPlan = this.reflector.getAllAndOverride<boolean | undefined>(
      ALLOW_WITHOUT_PLAN_ROUTE_KEY,
      [context.getHandler(), context.getClass()],
    );
    const role = request.actor?.role ?? '';
    return (
      isAllowedWithoutPlan !== true &&
      MANAGER_ROLES.has(role) &&
      !READ_ONLY_METHODS.has(request.method)
    );
  }
}
