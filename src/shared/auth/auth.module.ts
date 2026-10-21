import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { CenterModulesFinder } from '../centers/center-modules.finder';
import { ActiveMembershipFinder } from '../tenancy/active-membership.finder';
import { AccessTokenService } from './access-token.service';
import { AuthenticationGuard } from './guards/authentication.guard';
import { AuthorizationGuard } from './guards/authorization.guard';
import { ModuleGuard } from './guards/module.guard';
import { PlatformRoleFinder } from './platform-role.finder';
import { SecondFactorEnrollmentChecker } from './second-factor-enrollment.checker';
import { TenantGuard } from './guards/tenant.guard';

@Global()
@Module({
  providers: [
    AccessTokenService,
    ActiveMembershipFinder,
    SecondFactorEnrollmentChecker,
    PlatformRoleFinder,
    CenterModulesFinder,
    // El ORDEN importa: primero quién eres, luego a qué centro perteneces, al final qué puedes hacer.
    { provide: APP_GUARD, useClass: AuthenticationGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_GUARD, useClass: AuthorizationGuard },
    // Al final: ya se sabe el centro y quién llama; aquí se mira si el centro usa el módulo.
    { provide: APP_GUARD, useClass: ModuleGuard },
  ],
  exports: [AccessTokenService, ActiveMembershipFinder],
})
export class AuthModule {}
