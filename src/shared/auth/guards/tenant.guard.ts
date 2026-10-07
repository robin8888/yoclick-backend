import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { z } from 'zod';
import { DomainError } from '../../errors/domain-error';
import { HTTP_STATUS } from '../../errors/http-status';
import { ActiveMembershipFinder } from '../../tenancy/active-membership.finder';
import { readAccessPolicy } from '../access-policy';
import { type AuthenticatedRequest } from '../authenticated-request';

const centerIdSchema = z.uuid();

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

    request.actor = {
      userId: authenticatedUserId,
      centerId,
      membershipId: membership.membershipId,
      role: membership.role,
      permissions: membership.permissions,
    };
    return true;
  }
}
