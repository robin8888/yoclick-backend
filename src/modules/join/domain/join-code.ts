const JOIN_CODE_PATTERN = /^[A-Z0-9]{6}$/;

/** El código se teclea o se lee de un cartel: se tolera minúsculas y espacios, nada más. */
export function normalizeJoinCode(rawCode: string): string | null {
  const normalizedCode = rawCode.trim().toUpperCase();
  return JOIN_CODE_PATTERN.test(normalizedCode) ? normalizedCode : null;
}
