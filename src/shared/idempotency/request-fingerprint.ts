import { createHash } from 'node:crypto';

function sortKeysDeeply(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeeply);
  if (value === null || typeof value !== 'object') return value;

  const sortedEntries = Object.entries(value as Record<string, unknown>)
    .sort(([firstKey], [secondKey]) => firstKey.localeCompare(secondKey))
    .map(([key, nestedValue]) => [key, sortKeysDeeply(nestedValue)] as const);
  return Object.fromEntries(sortedEntries);
}

/**
 * Huella de «qué se pidió»: operación + cuerpo canónico (claves ordenadas). Si llega la misma
 * clave con otra huella, es un uso indebido (otro cuerpo u otro endpoint), no un reintento.
 */
export function computeRequestFingerprint(operation: string, requestBody: unknown): string {
  const canonicalBody = JSON.stringify(sortKeysDeeply(requestBody ?? {}));
  return createHash('sha256').update(`${operation}\n${canonicalBody}`).digest('hex');
}
