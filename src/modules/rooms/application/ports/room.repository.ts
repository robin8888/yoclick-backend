import { type ActorContext } from '../../../../shared/tenancy/actor-context';

/** Una sala o recurso tal y como lo ve la app. */
export interface RoomView {
  readonly id: string;
  readonly name: string;
  readonly capacity: number;
}

export interface NewRoom {
  readonly name: string;
  readonly capacity: number;
}

export type RoomCreationOutcome =
  | { readonly kind: 'created'; readonly room: RoomView }
  /** Ya hay una sala activa con ese nombre (sin distinguir mayúsculas). */
  | { readonly kind: 'duplicate_name' }
  | { readonly kind: 'limit_reached' };

export interface RoomRepository {
  /** Salas no archivadas, por orden de creación. */
  listRooms(actor: ActorContext): Promise<RoomView[]>;
  createRoom(actor: ActorContext, newRoom: NewRoom): Promise<RoomCreationOutcome>;
  /** Archiva (no borra) una sala y la quita de los servicios que la usaban. `false` si no existe. */
  archiveRoom(actor: ActorContext, roomId: string): Promise<boolean>;
}

export const ROOM_REPOSITORY = Symbol('ROOM_REPOSITORY');
