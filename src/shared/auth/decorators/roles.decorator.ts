import { SetMetadata } from '@nestjs/common';
import { type MembershipRoleName } from '../../tenancy/actor-context';

export const ALLOWED_ROLES_ROUTE_KEY = 'access-policy:roles';

/**
 * Ruta de un centro. Exige `X-Center-Id` verificado contra las membresías de la persona y que su
 * rol en ESE centro esté en la lista. La app puede ocultar UI por rol, pero la decisión es siempre de la API.
 */
export const Roles = (...roles: MembershipRoleName[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ALLOWED_ROLES_ROUTE_KEY, roles);
