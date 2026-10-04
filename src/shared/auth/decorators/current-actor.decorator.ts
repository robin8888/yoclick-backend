import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { DomainError } from '../../errors/domain-error';
import { HTTP_STATUS } from '../../errors/http-status';
import { type AuthenticatedRequest } from '../authenticated-request';

/** Contexto de la petición dentro de un centro, construido por `TenantGuard` desde la base de datos. */
export const CurrentActor = createParamDecorator((_input: unknown, context: ExecutionContext) => {
  const { actor } = context.switchToHttp().getRequest<AuthenticatedRequest>();
  if (actor === undefined) throw new DomainError('FORBIDDEN', HTTP_STATUS.forbidden);
  return actor;
});
