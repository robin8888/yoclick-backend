export type CenterStatusName = 'trial' | 'active' | 'past_due' | 'suspended';
export type MembershipStatusName = 'invited' | 'active' | 'blocked' | 'left';
export type MembershipRoleName = 'owner' | 'admin' | 'staff' | 'client';

export interface JoinableCenterFacts {
  readonly status: CenterStatusName;
  readonly isListed: boolean;
  readonly joinCode: string;
  readonly maxClients: number | null;
}

export interface ExistingMembershipFacts {
  readonly role: MembershipRoleName;
  readonly status: MembershipStatusName;
}

export interface JoinFacts {
  readonly center: JoinableCenterFacts;
  /** El código que presentó quien quiere unirse, ya normalizado; `null` si no presentó ninguno. */
  readonly presentedJoinCode: string | null;
  readonly existingMembership: ExistingMembershipFacts | null;
  readonly activeClientCount: number;
}

export type JoinDecision =
  | 'create_membership'
  | 'reactivate_membership'
  | 'already_member'
  | 'center_not_joinable'
  | 'membership_blocked'
  | 'client_limit_reached';

function isCenterOpenToJoin(
  center: JoinableCenterFacts,
  presentedJoinCode: string | null,
): boolean {
  if (center.status === 'suspended') return false;
  return center.isListed || presentedJoinCode === center.joinCode;
}

function decideForExistingMembership(existing: ExistingMembershipFacts): JoinDecision {
  if (existing.status === 'blocked') return 'membership_blocked';
  return existing.status === 'active' ? 'already_member' : 'reactivate_membership';
}

/**
 * Reglas de unirse como cliente, sin tocar la base de datos. Un centro privado solo admite a quien
 * presenta su código; uno listado, a cualquiera. El tope del plan cuenta clientes activos y no
 * bloquea a quien ya es miembro.
 */
export function decideJoin(facts: JoinFacts): JoinDecision {
  const { center, presentedJoinCode, existingMembership, activeClientCount } = facts;
  if (!isCenterOpenToJoin(center, presentedJoinCode)) return 'center_not_joinable';

  const existingDecision = existingMembership
    ? decideForExistingMembership(existingMembership)
    : null;
  if (existingDecision === 'membership_blocked' || existingDecision === 'already_member') {
    return existingDecision;
  }

  const isLimitReached = center.maxClients !== null && activeClientCount >= center.maxClients;
  if (isLimitReached) return 'client_limit_reached';
  return existingDecision ?? 'create_membership';
}
