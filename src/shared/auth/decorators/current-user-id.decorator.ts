import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { DomainError } from '../../errors/domain-error';
import { HTTP_STATUS } from '../../errors/http-status';
import { type AuthenticatedRequest } from '../authenticated-request';

/** La persona autenticada, tal como la fijó `AuthenticationGuard`. */
export const CurrentUserId = createParamDecorator((_input: unknown, context: ExecutionContext) => {
  const { authenticatedUserId } = context.switchToHttp().getRequest<AuthenticatedRequest>();
  if (authenticatedUserId === undefined) {
    throw new DomainError('UNAUTHENTICATED', HTTP_STATUS.unauthorized);
  }
  return authenticatedUserId;
});
