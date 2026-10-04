import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DomainError } from '../../errors/domain-error';
import { HTTP_STATUS } from '../../errors/http-status';
import { readAccessPolicy } from '../access-policy';
import { type AuthenticatedRequest } from '../authenticated-request';

/**
 * Tercer guard, DENY BY DEFAULT (SEC-53): una ruta sin política declarada, o cuyo rol no esté en la
 * lista, se deniega. Olvidar un decorador nunca deja una ruta abierta.
 */
@Injectable()
export class AuthorizationGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const policy = readAccessPolicy(this.reflector, context.getHandler(), context.getClass());

    switch (policy.kind) {
      case 'public':
      case 'user':
        return true;
      case 'roles': {
        const { actor } = context.switchToHttp().getRequest<AuthenticatedRequest>();
        const isRoleAllowed = actor !== undefined && policy.roles.includes(actor.role);
        if (!isRoleAllowed) throw new DomainError('FORBIDDEN', HTTP_STATUS.forbidden);
        return true;
      }
      case 'undeclared':
        throw new DomainError('FORBIDDEN', HTTP_STATUS.forbidden);
    }
  }
}
