import { Inject, Injectable } from '@nestjs/common';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import {
  CENTER_SUBSCRIPTION_REPOSITORY,
  type CenterSubscriptionFacts,
  type CenterSubscriptionRepository,
} from './ports/center-subscription.repository';

/** El estado del plan del centro. La suscripción se paga en la web: la app solo lo consulta. */
@Injectable()
export class GetCenterSubscriptionUseCase {
  constructor(
    @Inject(CENTER_SUBSCRIPTION_REPOSITORY)
    private readonly subscriptions: CenterSubscriptionRepository,
  ) {}

  async execute(actor: ActorContext): Promise<CenterSubscriptionFacts> {
    return this.subscriptions.find(actor);
  }
}
