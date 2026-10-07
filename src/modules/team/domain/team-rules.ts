export type TeamRoleName = 'owner' | 'admin' | 'staff' | 'client';
export type TeamMemberStatus = 'invited' | 'active' | 'blocked' | 'left';

export { TEAM_PERMISSIONS } from '../../../shared/tenancy/team-permissions';

const ROLE_RANK: Readonly<Record<TeamRoleName, number>> = {
  client: 0,
  staff: 1,
  admin: 2,
  owner: 3,
};

/** Quien tiene el rol más alto de los dos. Aceptar una invitación nunca rebaja a alguien. */
export function higherRole(first: TeamRoleName, second: TeamRoleName): TeamRoleName {
  return ROLE_RANK[first] >= ROLE_RANK[second] ? first : second;
}

/**
 * Quién puede invitar a qué rol. El personal solo invita clientes; la administración, también equipo
 * y otras administradoras. Nadie invita a una propietaria: la propiedad se crea con el centro.
 */
export function canInviteRole(inviterRole: TeamRoleName, invitedRole: TeamRoleName): boolean {
  if (invitedRole === 'owner') return false;
  if (inviterRole === 'owner' || inviterRole === 'admin') return true;
  return inviterRole === 'staff' && invitedRole === 'client';
}

export interface TeamChangeAttempt {
  readonly actor: { readonly userId: string; readonly role: TeamRoleName };
  readonly target: { readonly userId: string; readonly role: TeamRoleName };
  readonly isChangingRole: boolean;
  readonly isChangingStatus: boolean;
  readonly newRole: TeamRoleName | undefined;
}

export type TeamChangeDecision = 'allowed' | 'not_a_team_member' | 'forbidden';

function isForbiddenForAdmin(attempt: TeamChangeAttempt): boolean {
  const { actor, target, newRole } = attempt;
  const isOtherAdmin = target.role === 'admin' && target.userId !== actor.userId;
  return actor.role === 'admin' && (isOtherAdmin || newRole === 'admin');
}

/**
 * Reglas de quién puede modificar a quién en el equipo:
 * - la propietaria no se toca, y nadie cambia su propio rol ni su propio estado;
 * - una administradora no modifica a otra administradora ni nombra administradoras;
 * - solo la propietaria gestiona administradoras.
 */
export function decideTeamChange(attempt: TeamChangeAttempt): TeamChangeDecision {
  const { actor, target, isChangingRole, isChangingStatus } = attempt;
  if (target.role === 'client') return 'not_a_team_member';
  if (actor.role !== 'owner' && actor.role !== 'admin') return 'forbidden';
  if (target.role === 'owner') return 'forbidden';

  const isSelfEscalation = actor.userId === target.userId && (isChangingRole || isChangingStatus);
  return isSelfEscalation || isForbiddenForAdmin(attempt) ? 'forbidden' : 'allowed';
}
