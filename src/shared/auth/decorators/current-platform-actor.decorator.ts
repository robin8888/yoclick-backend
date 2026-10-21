import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { DomainError } from '../../errors/domain-error';
import { HTTP_STATUS } from '../../errors/http-status';
import { type AuthenticatedRequest } from '../authenticated-request';

/** Quien llama a una ruta de la plataforma, construido por `AuthorizationGuard` desde la base de datos. */
export const CurrentPlatformActor = createParamDecorator(
  (_input: unknown, context: ExecutionContext) => {
    const { platformActor } = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (platformActor === undefined) throw new DomainError('FORBIDDEN', HTTP_STATUS.forbidden);
    return platformActor;
  },
);
