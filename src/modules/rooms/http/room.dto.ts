import { z } from 'zod';
import { createZodDto } from '../../../shared/http/create-zod-dto';
import { roomPlaceShape } from '../../../shared/location/session-location';
import {
  DEFAULT_ROOM_CAPACITY,
  MAX_ROOM_CAPACITY,
  MAX_ROOM_NAME_LENGTH,
  MAX_SERVICES_PER_ROOM,
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
  /** Quien da clase en la sala; `null` si la puede usar cualquiera del equipo. */
  staff: z.strictObject({ membershipId: z.uuid(), fullName: z.string() }).nullable(),
  /** Servicio fijo: la sala solo da este; `null` = cualquiera de los suyos. */
  fixedService: z.strictObject({ id: z.uuid(), name: z.string() }).nullable(),
  /** Los servicios que se dan en esta sala. */
  services: z.array(z.strictObject({ id: z.uuid(), name: z.string() })),
  /** Dónde está si es un espacio exterior (parque, auditorio…); `null` si es una sala del centro. */
  place: roomPlaceShape.nullable(),
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
    /** La persona del equipo que da clase en la sala; sin ella, la puede usar cualquiera. */
    staffMembershipId: z.uuid().nullable().default(null),
    /** Servicio fijo: la sala solo dará este. Sin él, cualquiera de sus servicios. */
    serviceId: z.uuid().nullable().default(null),
    /** Los servicios que se darán en la sala (cada servicio tiene una sola sala fija). */
    serviceIds: z.array(z.uuid()).max(MAX_SERVICES_PER_ROOM).default([]),
    /** Si es un espacio exterior, dónde está; las clases que se den en ella lo heredan. */
    place: roomPlaceShape.nullable().default(null),
  }),
) {}

export class UpdateRoomRequestDto extends createZodDto(
  z.strictObject({
    name: z.string().trim().min(MIN_ROOM_NAME_LENGTH).max(MAX_ROOM_NAME_LENGTH).optional(),
    capacity: z.number().int().min(MIN_ROOM_CAPACITY).max(MAX_ROOM_CAPACITY).optional(),
    /** `null` quita al profesor de la sala. */
    staffMembershipId: z.uuid().nullable().optional(),
    /** `null` quita el servicio fijo de la sala. */
    serviceId: z.uuid().nullable().optional(),
    /** Los servicios que se dan en la sala; los que no estén dejan de darse en ella. */
    serviceIds: z.array(z.uuid()).max(MAX_SERVICES_PER_ROOM).optional(),
    /** `null` la deja como una sala del centro; cambiarlo avisa a quienes tienen clase en ella. */
    place: roomPlaceShape.nullable().optional(),
  }),
) {}
