import { type FastifyRequest } from 'fastify';
import { type ActorContext } from '../tenancy/actor-context';

export type PlatformRoleName = 'admin' | 'accountant';

export interface PlatformActorContext {
  readonly userId: string;
  readonly role: PlatformRoleName;
}

/** Petición tras pasar por los guards: lo que ponen ellos, nunca lo que mande el cliente. */
export interface AuthenticatedRequest extends FastifyRequest {
  authenticatedUserId?: string;
  /** true si la sesión pasó por un segundo factor (claim `amr` del token). */
  isMfaVerified?: boolean;
  actor?: ActorContext;
  /** Quien llama a una ruta de la plataforma, ya verificado con la base de datos y el segundo factor. */
  platformActor?: PlatformActorContext;
}
