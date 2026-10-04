/** Intentos fallidos seguidos antes de bloquear la cuenta un rato, además del límite por IP (SEC-46). */
export const MAX_FAILED_LOGIN_ATTEMPTS = 10;
export const ACCOUNT_LOCK_DURATION_MINUTES = 15;
/** La sesión larga de un dispositivo dura esto desde su último uso: cada refresh la renueva. */
export const REFRESH_TOKEN_TTL_DAYS = 30;
