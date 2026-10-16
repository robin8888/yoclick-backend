import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DomainError } from '../../errors/domain-error';
import { HTTP_STATUS } from '../../errors/http-status';
import { readAccessPolicy } from '../access-policy';
import { type AuthenticatedRequest } from '../authenticated-request';
import { STAFF_PERMISSION_ROUTE_KEY } from '../decorators/staff-permission.decorator';
import { type TeamPermission } from '../../tenancy/team-permissions';
import { SecondFactorEnrollmentChecker } from '../second-factor-enrollment.checker';
import { type ActorContext } from '../../tenancy/actor-context';

const ADMINISTRATIVE_ROLES: ReadonlySet<string> = new Set(['owner', 'admin']);

/**
 * Tercer guard, DENY BY DEFAULT (SEC-53): una ruta sin política declarada, o cuyo rol no esté en la
 * lista, se deniega. Olvidar un decorador nunca deja una ruta abierta.
 */
@Injectable()
export class AuthorizationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly enrollmentChecker: SecondFactorEnrollmentChecker,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const policy = readAccessPolicy(this.reflector, context.getHandler(), context.getClass());

    switch (policy.kind) {
      case 'public':
      case 'user':
        return true;
      case 'roles': {
        const { actor, isMfaVerified, authenticatedUserId } = context
          .switchToHttp()
          .getRequest<AuthenticatedRequest>();
        const isRoleAllowed =
          actor !== undefined &&
          (policy.roles.includes(actor.role) || this.isStaffWithGrantedPermission(actor, context));
        if (!isRoleAllowed) throw new DomainError('FORBIDDEN', HTTP_STATUS.forbidden);
        if (await this.isSecondFactorMissing({ actor, isMfaVerified, authenticatedUserId })) {
          throw new DomainError('MFA_REQUIRED', HTTP_STATUS.forbidden);
        }
        return true;
      }
      case 'undeclared':
        throw new DomainError('FORBIDDEN', HTTP_STATUS.forbidden);
    }
  }

  /**
   * Quien administra un centro y TIENE el segundo factor activado debe entrar con él (SEC-47). Activarlo es
   * opcional: quien no lo ha activado administra sin él, y puede activarlo cuando quiera desde su cuenta.
   */
  private async isSecondFactorMissing(input: {
    actor: ActorContext;
    isMfaVerified: boolean | undefined;
    authenticatedUserId: string | undefined;
  }): Promise<boolean> {
    const { actor, isMfaVerified, authenticatedUserId } = input;
    if (!ADMINISTRATIVE_ROLES.has(actor.role) || isMfaVerified === true) return false;
    if (authenticatedUserId === undefined) return true;
    return this.enrollmentChecker.hasConfirmedSecondFactor(authenticatedUserId);
  }

  /** Una profesional con el permiso que la ruta acepta. Solo `staff`: nadie más gana acceso por esto. */
  private isStaffWithGrantedPermission(actor: ActorContext, context: ExecutionContext): boolean {
    if (actor.role !== 'staff') return false;
    const requiredPermission = this.reflector.getAllAndOverride<TeamPermission | undefined>(
      STAFF_PERMISSION_ROUTE_KEY,
      [context.getHandler(), context.getClass()],
    );
    return requiredPermission !== undefined && actor.permissions.includes(requiredPermission);
  }
}
