import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ActiveMembershipFinder } from '../tenancy/active-membership.finder';
import { AccessTokenService } from './access-token.service';
import { AuthenticationGuard } from './guards/authentication.guard';
import { AuthorizationGuard } from './guards/authorization.guard';
import { TenantGuard } from './guards/tenant.guard';

@Global()
@Module({
  providers: [
    AccessTokenService,
    ActiveMembershipFinder,
    // El ORDEN importa: primero quién eres, luego a qué centro perteneces, al final qué puedes hacer.
    { provide: APP_GUARD, useClass: AuthenticationGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_GUARD, useClass: AuthorizationGuard },
  ],
  exports: [AccessTokenService, ActiveMembershipFinder],
})
export class AuthModule {}
