import { type ActorContext } from '../../../../shared/tenancy/actor-context';
import { type ClientLevelName } from '../../domain/client-rules';

/** Un grupo de clientes con quien lo da y cuántas personas tiene. */
export interface GroupView {
  readonly id: string;
  readonly name: string;
  readonly level: ClientLevelName | null;
  readonly instructor: { readonly membershipId: string; readonly fullName: string } | null;
  readonly memberCount: number;
}

export interface NewGroup {
  readonly name: string;
  readonly level: ClientLevelName | null;
  readonly instructorMembershipId: string | null;
}

export type GroupCreationOutcome =
  | { readonly kind: 'created'; readonly group: GroupView }
  /** Ya hay un grupo activo con ese nombre (sin distinguir mayúsculas). */
  | { readonly kind: 'duplicate_name' }
  /** Quien debe darlo no es del equipo activo de este centro. */
  | { readonly kind: 'unknown_instructor' }
  | { readonly kind: 'limit_reached' };

export interface GroupRepository {
  listGroups(actor: ActorContext): Promise<GroupView[]>;
  createGroup(actor: ActorContext, newGroup: NewGroup): Promise<GroupCreationOutcome>;
  /** Archiva (no borra) el grupo y saca de él a sus clientes. `false` si no existe. */
  archiveGroup(actor: ActorContext, groupId: string): Promise<boolean>;
}

export const GROUP_REPOSITORY = Symbol('GROUP_REPOSITORY');
