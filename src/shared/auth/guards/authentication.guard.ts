import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DomainError } from '../../errors/domain-error';
import { HTTP_STATUS } from '../../errors/http-status';
import { AccessTokenService } from '../access-token.service';
import { readAccessPolicy } from '../access-policy';
import { type AuthenticatedRequest } from '../authenticated-request';

const BEARER_TOKEN_PATTERN = /^Bearer ([\w.~+/-]+=*)$/;

function extractBearerToken(authorizationHeader: string | undefined): string {
  const token = BEARER_TOKEN_PATTERN.exec(authorizationHeader ?? '')?.[1];
  if (token === undefined) throw new DomainError('UNAUTHENTICATED', HTTP_STATUS.unauthorized);
  return token;
}

/** Primer guard: todo lo que no sea explícitamente público exige un token de acceso válido. */
@Injectable()
export class AuthenticationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly accessTokenService: AccessTokenService,
  ) {}

  // El contrato de un guard de Nest es "devolver true o lanzar": nunca devuelve false.
  // eslint-disable-next-line sonarjs/no-invariant-returns
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const policy = readAccessPolicy(this.reflector, context.getHandler(), context.getClass());
    if (policy.kind === 'public') return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = extractBearerToken(request.headers.authorization);
    const { userId } = await this.accessTokenService.verify(token);
    request.authenticatedUserId = userId;
    return true;
  }
}
