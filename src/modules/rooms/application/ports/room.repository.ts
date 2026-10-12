import { type ActorContext } from '../../../../shared/tenancy/actor-context';

/** Una sala o recurso tal y como lo ve la app. */
export interface RoomView {
  readonly id: string;
  readonly name: string;
  readonly capacity: number;
  /** Quien da clase en la sala; `null` si la puede usar cualquiera del equipo. */
  readonly staff: { readonly membershipId: string; readonly fullName: string } | null;
  /** Servicio fijo: la sala solo da este; `null` = cualquiera de los suyos. */
  readonly fixedService: { readonly id: string; readonly name: string } | null;
  /** Los servicios que se dan en esta sala. */
  readonly services: readonly { readonly id: string; readonly name: string }[];
}

export interface NewRoom {
  readonly name: string;
  readonly capacity: number;
  readonly staffMembershipId: string | null;
  readonly serviceId: string | null;
  readonly serviceIds: readonly string[];
}

export interface RoomPatch {
  readonly name?: string | undefined;
  readonly capacity?: number | undefined;
  /** `null` deja la sala sin profesor fijo. */
  readonly staffMembershipId?: string | null | undefined;
  /** `null` deja la sala sin servicio fijo. */
  readonly serviceId?: string | null | undefined;
  /** Los servicios que se dan en la sala; los demás dejan de darse en ella. */
  readonly serviceIds?: readonly string[] | undefined;
}

export type RoomCreationOutcome =
  | { readonly kind: 'created'; readonly room: RoomView }
  /** Ya hay una sala activa con ese nombre (sin distinguir mayúsculas). */
  | { readonly kind: 'duplicate_name' }
  | { readonly kind: 'limit_reached' }
  /** La persona indicada no es del equipo activo de este centro. */
  | { readonly kind: 'staff_not_found' }
  /** Algún servicio indicado no existe en este centro. */
  | { readonly kind: 'service_not_found' };

export type RoomUpdateOutcome =
  | { readonly kind: 'updated'; readonly room: RoomView }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'duplicate_name' }
  | { readonly kind: 'staff_not_found' }
  | { readonly kind: 'service_not_found' };

export interface RoomRepository {
  /** Salas no archivadas, por orden de creación. */
  listRooms(actor: ActorContext): Promise<RoomView[]>;
  createRoom(actor: ActorContext, newRoom: NewRoom): Promise<RoomCreationOutcome>;
  updateRoom(actor: ActorContext, roomId: string, patch: RoomPatch): Promise<RoomUpdateOutcome>;
  /** Archiva (no borra) una sala y la quita de los servicios que la usaban. `false` si no existe. */
  archiveRoom(actor: ActorContext, roomId: string): Promise<boolean>;
}

export const ROOM_REPOSITORY = Symbol('ROOM_REPOSITORY');
