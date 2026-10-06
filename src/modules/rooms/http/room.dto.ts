import { z } from 'zod';
import { createZodDto } from '../../../shared/http/create-zod-dto';
import {
  DEFAULT_ROOM_CAPACITY,
  MAX_ROOM_CAPACITY,
  MAX_ROOM_NAME_LENGTH,
  MIN_ROOM_CAPACITY,
  MIN_ROOM_NAME_LENGTH,
} from '../domain/room-rules';

export class CenterRouteParamsDto extends createZodDto(z.strictObject({ centerId: z.uuid() })) {}

export class RoomRouteParamsDto extends createZodDto(
  z.strictObject({ centerId: z.uuid(), roomId: z.uuid() }),
) {}

const roomShape = {
  id: z.uuid(),
  name: z.string(),
  /** Aforo máximo de la sala. */
  capacity: z.number().int(),
};

export class RoomResponseDto extends createZodDto(z.strictObject(roomShape)) {}
export class RoomListResponseDto extends createZodDto(
  z.strictObject({ rooms: z.array(z.strictObject(roomShape)) }),
) {}

export class CreateRoomRequestDto extends createZodDto(
  z.strictObject({
    name: z.string().trim().min(MIN_ROOM_NAME_LENGTH).max(MAX_ROOM_NAME_LENGTH),
    capacity: z
      .number()
      .int()
      .min(MIN_ROOM_CAPACITY)
      .max(MAX_ROOM_CAPACITY)
      .default(DEFAULT_ROOM_CAPACITY),
  }),
) {}
