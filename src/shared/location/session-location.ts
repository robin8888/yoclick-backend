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
