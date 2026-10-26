import { z } from 'zod';

const MAX_LOCATION_NAME_LENGTH = 120;
const MAX_LOCATION_ADDRESS_LENGTH = 250;
const MAX_LATITUDE = 90;
const MAX_LONGITUDE = 180;

/** Dónde se da una clase cuando no es en una sala del centro (un parque, un auditorio…). */
export interface SessionLocation {
  readonly name: string;
  readonly address: string | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
}

/** Las columnas donde se guarda: sin nombre no hay ubicación. */
export interface LocationColumns {
  readonly locationName: string | null;
  readonly locationAddress: string | null;
  readonly locationLatitude: number | null;
  readonly locationLongitude: number | null;
}

export const sessionLocationShape = z
  .strictObject({
    name: z.string().trim().min(1).max(MAX_LOCATION_NAME_LENGTH),
    address: z.string().trim().min(1).max(MAX_LOCATION_ADDRESS_LENGTH).nullable(),
    latitude: z.number().min(-MAX_LATITUDE).max(MAX_LATITUDE).nullable(),
    longitude: z.number().min(-MAX_LONGITUDE).max(MAX_LONGITUDE).nullable(),
  })
  .refine(
    (location) => (location.latitude === null) === (location.longitude === null),
    'send both coordinates or none',
  );

export function toLocationColumns(location: SessionLocation | null): LocationColumns {
  return {
    locationName: location?.name ?? null,
    locationAddress: location?.address ?? null,
    locationLatitude: location?.latitude ?? null,
    locationLongitude: location?.longitude ?? null,
  };
}

export function toSessionLocation(columns: LocationColumns): SessionLocation | null {
  if (columns.locationName === null) return null;
  return {
    name: columns.locationName,
    address: columns.locationAddress,
    latitude: columns.locationLatitude,
    longitude: columns.locationLongitude,
  };
}

/** Si dos ubicaciones son la misma (para avisar solo cuando de verdad cambia). */
export function isSameLocation(
  left: SessionLocation | null,
  right: SessionLocation | null,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Dónde está una sala exterior; la sala en sí pone el nombre. */
export interface RoomPlace {
  readonly address: string | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
}

export const roomPlaceShape = z
  .strictObject({
    address: z.string().trim().min(1).max(MAX_LOCATION_ADDRESS_LENGTH).nullable(),
    latitude: z.number().min(-MAX_LATITUDE).max(MAX_LATITUDE).nullable(),
    longitude: z.number().min(-MAX_LONGITUDE).max(MAX_LONGITUDE).nullable(),
  })
  .refine(
    (place) => (place.latitude === null) === (place.longitude === null),
    'send both coordinates or none',
  );

/** Las columnas de la sala donde se guarda: sin lugar, es una sala del centro. */
export interface RoomPlaceColumns {
  readonly isOutdoor: boolean;
  readonly placeAddress: string | null;
  readonly placeLatitude: number | null;
  readonly placeLongitude: number | null;
}

export function toRoomPlaceColumns(place: RoomPlace | null): RoomPlaceColumns {
  return {
    isOutdoor: place !== null,
    placeAddress: place?.address ?? null,
    placeLatitude: place?.latitude ?? null,
    placeLongitude: place?.longitude ?? null,
  };
}

export function toRoomPlace(columns: RoomPlaceColumns): RoomPlace | null {
  if (!columns.isOutdoor) return null;
  return {
    address: columns.placeAddress,
    latitude: columns.placeLatitude,
    longitude: columns.placeLongitude,
  };
}

/**
 * Dónde se da una sesión: lo que se le haya puesto a ella (un cambio de ese día o de su horario) y,
 * si no, el lugar de su sala cuando es exterior, con el nombre de la sala.
 */
export function resolveSessionLocation(
  own: SessionLocation | null,
  room: ({ readonly name: string } & RoomPlaceColumns) | null,
): SessionLocation | null {
  if (own !== null) return own;
  if (room === null || !room.isOutdoor) return null;
  return {
    name: room.name,
    address: room.placeAddress,
    latitude: room.placeLatitude,
    longitude: room.placeLongitude,
  };
}
