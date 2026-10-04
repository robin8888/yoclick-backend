const EARTH_RADIUS_KM = 6371;
const DEGREES_PER_HALF_TURN = 180;
const HALF = 0.5;
const SQUARED = 2;

export interface GeoPoint {
  readonly latitude: number;
  readonly longitude: number;
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / DEGREES_PER_HALF_TURN;
}

/** Distancia sobre la esfera (haversine): de sobra para ordenar centros cercanos. */
export function distanceInKilometers(from: GeoPoint, to: GeoPoint): number {
  const latitudeDelta = toRadians(to.latitude - from.latitude);
  const longitudeDelta = toRadians(to.longitude - from.longitude);
  const haversine =
    Math.sin(latitudeDelta * HALF) ** SQUARED +
    Math.cos(toRadians(from.latitude)) *
      Math.cos(toRadians(to.latitude)) *
      Math.sin(longitudeDelta * HALF) ** SQUARED;
  return SQUARED * EARTH_RADIUS_KM * Math.asin(Math.sqrt(haversine));
}
