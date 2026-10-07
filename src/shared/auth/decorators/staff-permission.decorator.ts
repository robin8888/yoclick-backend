import { SetMetadata } from '@nestjs/common';
import { type TeamPermission } from '../../tenancy/team-permissions';

export const STAFF_PERMISSION_ROUTE_KEY = 'access-policy:staff-permission';

/**
 * Además de los roles de `@Roles`, deja pasar a una profesional (`staff`) a la que el centro ha dado
 * este permiso. Sin el permiso sigue siendo un 403: el rol por sí solo no lo concede.
 */
export const AllowStaffWithPermission = (
  permission: TeamPermission,
): MethodDecorator & ClassDecorator => SetMetadata(STAFF_PERMISSION_ROUTE_KEY, permission);
