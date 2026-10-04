import { type FastifyRequest } from 'fastify';
import { type ActorContext } from '../tenancy/actor-context';

/** Petición tras pasar por los guards: lo que ponen ellos, nunca lo que mande el cliente. */
export interface AuthenticatedRequest extends FastifyRequest {
  authenticatedUserId?: string;
  actor?: ActorContext;
}
