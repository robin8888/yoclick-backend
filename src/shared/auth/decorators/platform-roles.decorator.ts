import { SetMetadata } from '@nestjs/common';
import { type PlatformRoleName } from '../authenticated-request';

export const PLATFORM_ROLES_ROUTE_KEY = 'access-policy:platform-roles';

/**
 * Ruta de la administración de la plataforma (`/platform/*`). No lleva `X-Center-Id`: exige que la
 * persona tenga uno de estos roles de plataforma (leídos de la base de datos, nunca del cliente) y que
 * su sesión se haya abierto con segundo factor.
 */
export const PlatformRoles = (...roles: PlatformRoleName[]): MethodDecorator & ClassDecorator =>
  SetMetadata(PLATFORM_ROLES_ROUTE_KEY, roles);
