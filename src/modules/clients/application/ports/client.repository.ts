import { type ActorContext } from '../../../../shared/tenancy/actor-context';
import { type ClientActivity } from '../../domain/client-activity';
import { type ClientLevelName, type ClientStatusFilter } from '../../domain/client-rules';

/** Un cliente tal y como lo ve quien administra el centro. */
export interface ClientView {
  readonly membershipId: string;
  readonly fullName: string;
  readonly email: string;
  readonly status: 'active' | 'blocked';
  readonly activity: ClientActivity;
  readonly level: ClientLevelName | null;
  readonly group: { readonly id: string; readonly name: string } | null;
  readonly joinedAt: Date;
  readonly bookingCount: number;
  readonly lastBookingAt: Date | null;
  /** La próxima cita no cancelada, o `null` si no tiene ninguna por delante. */
  readonly nextBookingAt: Date | null;
}

export interface ClientListQuery {
  /** Texto que debe aparecer en el nombre o el correo; sin distinguir mayúsculas. */
  readonly search: string | null;
  readonly status: ClientStatusFilter | null;
  /** Solo las personas de este grupo. */
  readonly groupId: string | null;
  /** Si lo pide una profesional, solo quienes tienen citas con ella (y las cuentas son suyas). */
  readonly staffMembershipId: string | null;
  readonly limit: number;
  readonly offset: number;
  readonly now: Date;
}

export interface ClientListResult {
  /** Todos los clientes del centro, sin filtros: es la cifra de la pestaña «Alumnos (212)». */
  readonly totalClientCount: number;
  /** Los que cumplen la búsqueda y el estado, antes de paginar. */
  readonly matchingCount: number;
  readonly clients: readonly ClientView[];
}

/** Solo lo enviado cambia; `null` quita el nivel o saca al cliente de su grupo. */
export interface ClientPatch {
  readonly level?: ClientLevelName | null | undefined;
  readonly groupId?: string | null | undefined;
}

export interface ClientChange {
  readonly membershipId: string;
  readonly patch: ClientPatch;
  readonly now: Date;
}

export type ClientUpdateOutcome =
  | { readonly kind: 'saved'; readonly client: ClientView }
  | { readonly kind: 'not_found' }
  /** El grupo no existe, está archivado o es de otro centro. */
  | { readonly kind: 'unknown_group' };

export interface ClientRepository {
  listClients(actor: ActorContext, query: ClientListQuery): Promise<ClientListResult>;
  /** `null` si no existe en este centro o no es un cliente. */
  findClient(actor: ActorContext, membershipId: string, now: Date): Promise<ClientView | null>;
  updateClient(actor: ActorContext, change: ClientChange): Promise<ClientUpdateOutcome>;
}

export const CLIENT_REPOSITORY = Symbol('CLIENT_REPOSITORY');
