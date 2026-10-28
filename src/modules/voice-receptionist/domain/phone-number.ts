const SPAIN_COUNTRY_CODE = '34';
const SPAIN_NATIONAL_NUMBER_LENGTH = 9;
const INTERNATIONAL_PREFIX = '00';
const E164_PATTERN = /^\+\d{8,15}$/;

/**
 * Deja un teléfono en formato E.164 (`+34600111222`) o devuelve `null` si no se puede. Quien llama llega con
 * el formato que ponga la operadora o el proveedor; los números de 9 cifras se toman como españoles.
 */
export function normalizePhoneNumber(rawPhoneNumber: string): string | null {
  const compact = rawPhoneNumber.trim().replace(/[\s().-]/g, '');
  const withPlus = compact.startsWith(INTERNATIONAL_PREFIX)
    ? `+${compact.slice(INTERNATIONAL_PREFIX.length)}`
    : compact;
  const candidate =
    /^\d+$/.test(withPlus) && withPlus.length === SPAIN_NATIONAL_NUMBER_LENGTH
      ? `+${SPAIN_COUNTRY_CODE}${withPlus}`
      : withPlus;
  return E164_PATTERN.test(candidate) ? candidate : null;
}

export function isE164PhoneNumber(phoneNumber: string): boolean {
  return E164_PATTERN.test(phoneNumber);
}

/** Los teléfonos del centro se comparan ya normalizados: «600 11 22 33» y «+34600112233» son el mismo. */
export function arePhoneNumbersEqual(first: string, second: string): boolean {
  const normalizedFirst = normalizePhoneNumber(first);
  return normalizedFirst !== null && normalizedFirst === normalizePhoneNumber(second);
}
