import { MILLISECONDS_PER_DAY } from '../../../shared/time/time-units';

export const MIN_RATE_NAME_LENGTH = 2;
export const MAX_RATE_NAME_LENGTH = 80;
export const MIN_RATE_SESSIONS = 1;
export const MAX_RATE_SESSIONS = 200;
export const MIN_RATE_VALID_DAYS = 1;
export const MAX_RATE_VALID_DAYS = 730;
export const MAX_RATE_PRICE_CENTS = 1_000_000;
export const MAX_RATE_SERVICES = 50;
export const MAX_RATES_PER_CENTER = 50;

/** Los estados que ve la app: los dos primeros se guardan, los demás se deducen de sesiones y fecha. */
export type PassStatusName = 'pending' | 'active' | 'exhausted' | 'expired' | 'rejected';

export interface StoredPassState {
  readonly status: 'pending' | 'active' | 'rejected';
  readonly remainingSessions: number;
  readonly expiresAt: Date | null;
}

/** «Agotado» y «caducado» no se guardan: se calculan, así no hace falta un proceso que los marque. */
export function resolvePassStatus(pass: StoredPassState, now: Date): PassStatusName {
  if (pass.status !== 'active') return pass.status;
  if (pass.expiresAt !== null && pass.expiresAt.getTime() <= now.getTime()) return 'expired';
  return pass.remainingSessions > 0 ? 'active' : 'exhausted';
}

export function computePassExpiry(startsAt: Date, validDays: number): Date {
  return new Date(startsAt.getTime() + validDays * MILLISECONDS_PER_DAY);
}

export interface ConsumablePass {
  readonly id: string;
  readonly status: StoredPassState['status'];
  readonly remainingSessions: number;
  readonly expiresAt: Date | null;
  /** Servicios en los que vale; vacío = todos. */
  readonly serviceIds: readonly string[];
}

/**
 * De qué bono sale la clase: del que antes caduca entre los que valen para ese servicio, así no se
 * pierde ninguno por caducidad mientras otro más largo sigue disponible.
 */
export function pickPassToConsume(
  passes: readonly ConsumablePass[],
  input: { serviceId: string; now: Date },
): string | null {
  const usable = passes.filter(
    (pass) =>
      resolvePassStatus(pass, input.now) === 'active' &&
      (pass.serviceIds.length === 0 || pass.serviceIds.includes(input.serviceId)),
  );
  const [first] = [...usable].sort(
    (left, right) =>
      (left.expiresAt?.getTime() ?? Number.MAX_SAFE_INTEGER) -
      (right.expiresAt?.getTime() ?? Number.MAX_SAFE_INTEGER),
  );
  return first?.id ?? null;
}
