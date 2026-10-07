import { type ActorContext } from '../../../../shared/tenancy/actor-context';

export interface CenterSubscriptionFacts {
  readonly status: 'trial' | 'active' | 'past_due' | 'suspended';
  readonly trialEndsAt: Date | null;
  /** Tope de clientes activos del plan; `null` si no tiene. */
  readonly maxClients: number | null;
  readonly activeClientCount: number;
}

export interface CenterSubscriptionRepository {
  find(actor: ActorContext): Promise<CenterSubscriptionFacts>;
}

export const CENTER_SUBSCRIPTION_REPOSITORY = Symbol('CENTER_SUBSCRIPTION_REPOSITORY');
