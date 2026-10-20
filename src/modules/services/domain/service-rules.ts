export const MIN_SERVICE_NAME_LENGTH = 2;
export const MAX_SERVICE_NAME_LENGTH = 80;
export const MAX_SERVICE_DESCRIPTION_LENGTH = 500;
export const MIN_SERVICE_DURATION_MINUTES = 15;
export const MAX_SERVICE_DURATION_MINUTES = 480;
export const SERVICE_DURATION_STEP_MINUTES = 5;
/** Cuatro horas de margen son ya un error de teclado, no un margen. */
export const MAX_SERVICE_BUFFER_MINUTES = 240;
export const MIN_BOOKING_WINDOW_DAYS = 1;
export const MAX_BOOKING_WINDOW_DAYS = 365;
/** 60 días. */
export const MAX_MIN_NOTICE_MINUTES = 86_400;
/** Un precio de millones de euros es un error de teclado, no un servicio. */
export const MAX_SERVICE_PRICE_CENTS = 10_000_000;
export const MAX_STAFF_PER_SERVICE = 50;
export const SERVICE_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

/** De 0 a 4 horas, de 5 en 5: el margen cuadra con la rejilla de duraciones. */
export function isValidServiceBuffer(bufferMinutes: number): boolean {
  return (
    bufferMinutes >= 0 &&
    bufferMinutes <= MAX_SERVICE_BUFFER_MINUTES &&
    bufferMinutes % SERVICE_DURATION_STEP_MINUTES === 0
  );
}

/** Entre 15 minutos y 8 horas, de 5 en 5: la rejilla de huecos nunca tiene cortes raros. */
export function isValidServiceDuration(durationMinutes: number): boolean {
  return (
    durationMinutes >= MIN_SERVICE_DURATION_MINUTES &&
    durationMinutes <= MAX_SERVICE_DURATION_MINUTES &&
    durationMinutes % SERVICE_DURATION_STEP_MINUTES === 0
  );
}
