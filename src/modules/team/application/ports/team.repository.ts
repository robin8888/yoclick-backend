import { type ActorContext } from '../../../../shared/tenancy/actor-context';
import { type TeamMemberStatus, type TeamRoleName } from '../../domain/team-rules';

export interface TeamMember {
  readonly membershipId: string;
  readonly userId: string;
  readonly fullName: string;
  readonly email: string;
  /** Ruta de su foto de perfil; la API la convierte en un enlace firmado. */
  readonly photoKey: string | null;
  readonly role: TeamRoleName;
  readonly status: TeamMemberStatus;
  readonly staffTitle: string | null;
  readonly permissions: readonly string[];
  /** Los servicios que da esta persona (los activos del catálogo). */
  readonly services: readonly { readonly id: string; readonly name: string }[];
  readonly joinedAt: Date;
}

export interface TeamMemberUpdate {
  readonly role?: 'admin' | 'staff' | undefined;
  readonly status?: 'active' | 'blocked' | 'left' | undefined;
  readonly permissions?: readonly string[] | undefined;
  readonly staffTitle?: string | null | undefined;
  /** Los servicios que da; los demás dejan de darse por esta persona. */
  readonly serviceIds?: readonly string[] | undefined;
}

export interface TeamRepository {
  /** Quienes trabajan en el centro: propietaria, administración y personal. Sin clientes ni bajas. */
  listTeam(actor: ActorContext): Promise<TeamMember[]>;
  findMember(actor: ActorContext, membershipId: string): Promise<TeamMember | null>;
  /** `null` si algún servicio indicado no existe en este centro. */
  updateMember(
    actor: ActorContext,
    membershipId: string,
    update: TeamMemberUpdate,
  ): Promise<TeamMember | null>;
}

export const TEAM_REPOSITORY = Symbol('TEAM_REPOSITORY');
