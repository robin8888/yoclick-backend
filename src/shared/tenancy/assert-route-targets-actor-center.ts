import { DomainError } from '../errors/domain-error';
import { HTTP_STATUS } from '../errors/http-status';
import { type ActorContext } from './actor-context';

/** La ruta lleva el id del centro; solo se atiende el del `X-Center-Id` verificado. Cualquier otro es un 404. */
export function assertRouteTargetsActorCenter(actor: ActorContext, routeCenterId: string): void {
  if (routeCenterId !== actor.centerId) throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
}
