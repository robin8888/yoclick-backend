import { randomInt } from 'node:crypto';

export const VERIFICATION_CODE_LENGTH = 6;
const DECIMAL_BASE = 10;
const VERIFICATION_CODE_SPACE = DECIMAL_BASE ** VERIFICATION_CODE_LENGTH;

/** Intentos permitidos por código. Con 1.000.000 de posibilidades, 5 intentos dejan ~0,0005 % de acierto al azar. */
export const MAX_VERIFICATION_ATTEMPTS = 5;
export const EMAIL_VERIFICATION_CODE_TTL_MINUTES = 15;
export const PASSWORD_RESET_CODE_TTL_MINUTES = 30;
/** No se envía otro código si el anterior es más reciente que esto: frena el envío masivo de correos. */
export const MIN_SECONDS_BETWEEN_CODES = 60;

/** Código aleatorio criptográficamente seguro (no `Math.random`), con ceros a la izquierda. */
export function generateVerificationCode(): string {
  return String(randomInt(VERIFICATION_CODE_SPACE)).padStart(VERIFICATION_CODE_LENGTH, '0');
}
