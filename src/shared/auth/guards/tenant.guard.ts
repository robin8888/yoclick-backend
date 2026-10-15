import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { z } from 'zod';
import { DomainError } from '../../errors/domain-error';
import { HTTP_STATUS } from '../../errors/http-status';
import {
  ActiveMembershipFinder,
  type ActiveMembership,
} from '../../tenancy/active-membership.finder';
import { readAccessPolicy } from '../access-policy';
import { type AuthenticatedRequest } from '../authenticated-request';

const centerIdSchema = z.uuid();
const actingForSchema = z.uuid();

function readCenterIdHeader(headerValue: string | string[] | undefined): string {
  const parsingResult = centerIdSchema.safeParse(headerValue);
  if (!parsingResult.success) throw new DomainError('BAD_REQUEST', HTTP_STATUS.badRequest);
  return parsingResult.data;
}

/**
 * Segundo guard: en las rutas de un centro, verifica `X-Center-Id` contra las membresías de la
 * persona y construye el `ActorContext` con datos de la base (SEC-40). El rol y el centro nunca se
 * toman de lo que envíe el cliente.
 *
 * Un centro ajeno y un centro inexistente responden igual (404): no se revela cuáles existen.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly activeMembershipFinder: ActiveMembershipFinder,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const policy = readAccessPolicy(this.reflector, context.getHandler(), context.getClass());
    if (policy.kind !== 'roles') return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const { authenticatedUserId } = request;
    if (authenticatedUserId === undefined) {
      throw new DomainError('UNAUTHENTICATED', HTTP_STATUS.unauthorized);
    }

    const centerId = readCenterIdHeader(request.headers['x-center-id']);
    const membership = await this.activeMembershipFinder.find(authenticatedUserId, centerId);
    if (!membership) throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);

    const actingMembership = await this.resolveActingMembership({
      request,
      userId: authenticatedUserId,
      centerId,
      membership,
    });
    request.actor = {
      userId: authenticatedUserId,
      centerId,
      membershipId: actingMembership.membershipId,
      role: actingMembership.role,
      permissions: actingMembership.permissions,
    };
    return true;
  }

  /**
   * Un tutor puede actuar en nombre de su hijo con `X-Acting-For`: reservar, cancelar, ver sus
   * bonos. Solo si el centro lo ha enlazado como tutor; si no, 403. Para el resto de peticiones
   * esa cabecera no existe y actúa por sí mismo.
   */
  private async resolveActingMembership(input: {
    request: AuthenticatedRequest;
    userId: string;
    centerId: string;
    membership: ActiveMembership;
  }): Promise<ActiveMembership> {
    const { request, userId, centerId, membership } = input;
    const rawChildId = request.headers['x-acting-for'];
    if (rawChildId === undefined) return membership;
    const parsedChildId = actingForSchema.safeParse(rawChildId);
    if (!parsedChildId.success || membership.role !== 'client') {
      throw new DomainError('FORBIDDEN', HTTP_STATUS.forbidden);
    }
    const child = await this.activeMembershipFinder.findChildOfGuardian({
      userId,
      centerId,
      membershipId: membership.membershipId,
      childMembershipId: parsedChildId.data,
    });
    if (!child) throw new DomainError('FORBIDDEN', HTTP_STATUS.forbidden);
    return child;
  }
}
