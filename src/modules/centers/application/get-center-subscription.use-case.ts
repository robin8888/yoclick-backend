import { Inject, Injectable } from '@nestjs/common';
import { isPlanRequired } from '../../../shared/centers/plan-access';
import { listPlanFeatures, type PlanFeatureId } from '../../../shared/centers/plan-features';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import {
  CENTER_SUBSCRIPTION_REPOSITORY,
  type CenterSubscriptionFacts,
  type CenterSubscriptionRepository,
} from './ports/center-subscription.repository';

export interface CenterSubscription extends CenterSubscriptionFacts {
  readonly isPlanRequired: boolean;
  readonly features: readonly PlanFeatureId[];
}

/** El estado del plan del centro. La suscripción se paga en la web: la app solo lo consulta. */
@Injectable()
export class GetCenterSubscriptionUseCase {
  constructor(
    @Inject(CENTER_SUBSCRIPTION_REPOSITORY)
    private readonly subscriptions: CenterSubscriptionRepository,
  ) {}

  async execute(actor: ActorContext): Promise<CenterSubscription> {
    const facts = await this.subscriptions.find(actor);
    return {
      ...facts,
      isPlanRequired: isPlanRequired(facts, new Date()),
      features: listPlanFeatures(facts.planId),
    };
  }
}
