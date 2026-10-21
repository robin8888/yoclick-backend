import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DomainError } from '../../errors/domain-error';
import { HTTP_STATUS } from '../../errors/http-status';
import { readAccessPolicy } from '../access-policy';
import { type AuthenticatedRequest, type PlatformRoleName } from '../authenticated-request';
import { PlatformRoleFinder } from '../platform-role.finder';
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
    private readonly platformRoleFinder: PlatformRoleFinder,
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
      case 'platform':
        return this.authorizePlatformRoute(context, policy.roles);
      case 'undeclared':
        throw new DomainError('FORBIDDEN', HTTP_STATUS.forbidden);
    }
  }

  /**
   * Administración de la plataforma: el rol sale de la base de datos y la sesión debe haberse abierto con
   * segundo factor. A quien no tiene rol de plataforma se le responde como a una ruta que no existe, para
   * no revelar que hay una administración.
   */
  private async authorizePlatformRoute(
    context: ExecutionContext,
    allowedRoles: readonly PlatformRoleName[],
  ): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const { authenticatedUserId } = request;
    if (authenticatedUserId === undefined) {
      throw new DomainError('UNAUTHENTICATED', HTTP_STATUS.unauthorized);
    }
    const role = await this.platformRoleFinder.find(authenticatedUserId);
    if (role === null) throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
    if (!allowedRoles.includes(role)) throw new DomainError('FORBIDDEN', HTTP_STATUS.forbidden);
    if (request.isMfaVerified !== true)
      throw new DomainError('MFA_REQUIRED', HTTP_STATUS.forbidden);
    request.platformActor = { userId: authenticatedUserId, role };
    return true;
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
