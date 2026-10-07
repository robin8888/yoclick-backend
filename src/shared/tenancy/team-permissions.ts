/** Permisos extra que el equipo puede recibir; el rol por sí solo no los concede. */
export const TEAM_PERMISSIONS = [
  'health:read',
  'clients:manage',
  'services:manage',
  'agenda:manage',
  'payments:view',
  'reports:view',
] as const;

export type TeamPermission = (typeof TEAM_PERMISSIONS)[number];

/** Lo guardado es JSON libre: solo cuentan los permisos que esta versión conoce. */
export function readStoredPermissions(stored: unknown): TeamPermission[] {
  if (!Array.isArray(stored)) return [];
  return TEAM_PERMISSIONS.filter((permission) => stored.includes(permission));
}
