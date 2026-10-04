export type MembershipRoleName = 'owner' | 'admin' | 'staff' | 'client';

/** Quién hace la petición. Lo construye el TenantGuard; nunca viene del cuerpo de la petición. */
export interface ActorContext {
  readonly userId: string;
  readonly centerId: string;
  readonly membershipId: string;
  readonly role: MembershipRoleName;
  readonly permissions: readonly string[];
}
