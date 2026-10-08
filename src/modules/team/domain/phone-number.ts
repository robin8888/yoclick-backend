const SPAIN_PREFIX = '+34';
const SPANISH_MOBILE_LENGTH = 9;
const MIN_INTERNATIONAL_DIGITS = 8;
const MAX_INTERNATIONAL_DIGITS = 15;
const COUNTRY_PREFIX_LENGTH = 3;
const VISIBLE_LAST_DIGITS = 3;
const INTERNATIONAL_CALL_PREFIX = '00';

/**
 * Deja un teléfono como `+34600111222`: sin espacios, guiones ni paréntesis. Un número de 9 cifras
 * sin prefijo se toma como español; el resto debe venir con `+` (o `00`). `null` si no es un teléfono.
 */
export function normalizePhoneNumber(rawPhone: string): string | null {
  const compact = rawPhone.replace(/[\s().-]/g, '');
  const withPlus = compact.startsWith(INTERNATIONAL_CALL_PREFIX)
    ? `+${compact.slice(INTERNATIONAL_CALL_PREFIX.length)}`
    : compact;
  const isLocalSpanish = /^\d+$/.test(withPlus) && withPlus.length === SPANISH_MOBILE_LENGTH;
  const international = isLocalSpanish ? `${SPAIN_PREFIX}${withPlus}` : withPlus;
  if (!/^\+\d+$/.test(international)) return null;
  const digitCount = international.length - 1;
  const isLengthValid =
    digitCount >= MIN_INTERNATIONAL_DIGITS && digitCount <= MAX_INTERNATIONAL_DIGITS;
  return isLengthValid ? international : null;
}

/** `+34600111222` → `+34 ••• ••• 222`: reconocible para quien lo recibió, inútil para un tercero. */
export function maskPhoneNumber(phone: string): string {
  return `${phone.slice(0, COUNTRY_PREFIX_LENGTH)} ••• ••• ${phone.slice(-VISIBLE_LAST_DIGITS)}`;
}
