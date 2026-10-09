import { type ActorContext } from '../../../../shared/tenancy/actor-context';

export interface CenterSubscriptionFacts {
  readonly status: 'trial' | 'active' | 'past_due' | 'suspended';
  readonly trialEndsAt: Date | null;
  /** Tope de clientes activos del plan; `null` si no tiene. */
  readonly maxClients: number | null;
  readonly activeClientCount: number;
  /** Espacio de vídeo contratado; `null` si el plan no incluye vídeo. */
  readonly videoStorageLimitBytes: number | null;
  readonly videoStorageUsedBytes: number;
  /** Espacio de fotos de la galería del equipo: tope del plan y lo que ocupan. */
  readonly photoStorage: { readonly usedBytes: number; readonly limitBytes: number };
}

export interface CenterSubscriptionRepository {
  find(actor: ActorContext): Promise<CenterSubscriptionFacts>;
}

export const CENTER_SUBSCRIPTION_REPOSITORY = Symbol('CENTER_SUBSCRIPTION_REPOSITORY');
