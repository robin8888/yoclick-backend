import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '../../../shared/errors/domain-error';
import { HTTP_STATUS } from '../../../shared/errors/http-status';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import {
  ROOM_REPOSITORY,
  type NewRoom,
  type RoomPatch,
  type RoomRepository,
  type RoomView,
} from './ports/room.repository';

@Injectable()
export class ListRoomsUseCase {
  constructor(@Inject(ROOM_REPOSITORY) private readonly rooms: RoomRepository) {}

  async execute(actor: ActorContext): Promise<RoomView[]> {
    return this.rooms.listRooms(actor);
  }
}

@Injectable()
export class CreateRoomUseCase {
  constructor(@Inject(ROOM_REPOSITORY) private readonly rooms: RoomRepository) {}

  async execute(actor: ActorContext, newRoom: NewRoom): Promise<RoomView> {
    const outcome = await this.rooms.createRoom(actor, newRoom);
    if (outcome.kind === 'created') return outcome.room;
    if (outcome.kind === 'duplicate_name') {
      throw new DomainError('CONFLICT', HTTP_STATUS.conflict, [
        { path: 'name', code: 'room_name_taken' },
      ]);
    }
    if (outcome.kind === 'staff_not_found' || outcome.kind === 'service_not_found') {
      throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
    }
    throw new DomainError('VALIDATION_FAILED', HTTP_STATUS.badRequest, [
      { path: 'name', code: 'too_many_rooms' },
    ]);
  }
}

/** Cambia el nombre, el aforo o el profesor de una sala; las citas ya puestas no se tocan. */
@Injectable()
export class UpdateRoomUseCase {
  constructor(@Inject(ROOM_REPOSITORY) private readonly rooms: RoomRepository) {}

  async execute(actor: ActorContext, roomId: string, patch: RoomPatch): Promise<RoomView> {
    const outcome = await this.rooms.updateRoom(actor, roomId, patch);
    if (outcome.kind === 'updated') return outcome.room;
    if (outcome.kind === 'duplicate_name') {
      throw new DomainError('CONFLICT', HTTP_STATUS.conflict, [
        { path: 'name', code: 'room_name_taken' },
      ]);
    }
    throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
  }
}

/** Archivar conserva el rastro; los servicios que usaban la sala quedan «sin sala fija». */
@Injectable()
export class ArchiveRoomUseCase {
  constructor(@Inject(ROOM_REPOSITORY) private readonly rooms: RoomRepository) {}

  async execute(actor: ActorContext, roomId: string): Promise<void> {
    const wasArchived = await this.rooms.archiveRoom(actor, roomId);
    if (!wasArchived) throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
  }
}
