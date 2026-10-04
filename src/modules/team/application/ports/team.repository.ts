import { type ActorContext } from '../../../../shared/tenancy/actor-context';
import { type TeamMemberStatus, type TeamRoleName } from '../../domain/team-rules';

export interface TeamMember {
  readonly membershipId: string;
  readonly userId: string;
  readonly fullName: string;
  readonly email: string;
  readonly role: TeamRoleName;
  readonly status: TeamMemberStatus;
  readonly staffTitle: string | null;
  readonly permissions: readonly string[];
  readonly joinedAt: Date;
}

export interface TeamMemberUpdate {
  readonly role?: 'admin' | 'staff' | undefined;
  readonly status?: 'active' | 'blocked' | 'left' | undefined;
  readonly permissions?: readonly string[] | undefined;
  readonly staffTitle?: string | null | undefined;
}

export interface TeamRepository {
  /** Quienes trabajan en el centro: propietaria, administración y personal. Sin clientes ni bajas. */
  listTeam(actor: ActorContext): Promise<TeamMember[]>;
  findMember(actor: ActorContext, membershipId: string): Promise<TeamMember | null>;
  updateMember(
    actor: ActorContext,
    membershipId: string,
    update: TeamMemberUpdate,
  ): Promise<TeamMember>;
}

export const TEAM_REPOSITORY = Symbol('TEAM_REPOSITORY');
