import { MILLISECONDS_PER_MINUTE } from '../../../shared/time/time-units';

/** Tres códigos erróneos seguidos desde el mismo número y la llamada pasa a una persona. */
export const MAX_FAILED_CODE_ATTEMPTS = 3;
export const CODE_LOCKOUT_MINUTES = 30;

export interface CodeAttemptState {
  readonly failedCount: number;
  readonly lockedUntil: Date | null;
}

export const NO_CODE_ATTEMPTS: CodeAttemptState = { failedCount: 0, lockedUntil: null };

export function isCodeLookupLocked(state: CodeAttemptState, now: Date): boolean {
  return state.lockedUntil !== null && state.lockedUntil > now;
}

/** Un fallo más; al llegar al máximo se bloquea el número un rato y el contador vuelve a empezar. */
export function registerFailedCodeAttempt(state: CodeAttemptState, now: Date): CodeAttemptState {
  if (isCodeLookupLocked(state, now)) return state;
  const failedCount = state.failedCount + 1;
  if (failedCount < MAX_FAILED_CODE_ATTEMPTS) return { failedCount, lockedUntil: null };
  return {
    failedCount: 0,
    lockedUntil: new Date(now.getTime() + CODE_LOCKOUT_MINUTES * MILLISECONDS_PER_MINUTE),
  };
}

/** Cuántos intentos quedan antes de pasar a una persona; el bot lo usa para decir «prueba otra vez». */
export function countRemainingCodeAttempts(state: CodeAttemptState, now: Date): number {
  return isCodeLookupLocked(state, now) ? 0 : MAX_FAILED_CODE_ATTEMPTS - state.failedCount;
}
