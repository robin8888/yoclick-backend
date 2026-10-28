import { MILLISECONDS_PER_HOUR } from '../../../shared/time/time-units';

/** La hora natural (UTC) en la que se cuentan los fallos del centro. */
export function resolveFailureWindowStart(now: Date): Date {
  return new Date(Math.floor(now.getTime() / MILLISECONDS_PER_HOUR) * MILLISECONDS_PER_HOUR);
}

/**
 * Con el tope alcanzado el bot ya no prueba más códigos y pasa a una persona. Es la defensa contra quien llama
 * desde muchos números distintos: el límite por número no lo frena.
 */
export function isCenterCodeFailureCapReached(failedCount: number, cap: number): boolean {
  return failedCount >= cap;
}
