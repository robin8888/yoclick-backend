import { createHash } from 'node:crypto';

const UUID_VERSION_FIVE_MASK = 0x50;
const UUID_VERSION_CLEAR_MASK = 0x0f;
const UUID_VARIANT_MASK = 0x80;
const UUID_VARIANT_CLEAR_MASK = 0x3f;
const UUID_BYTE_COUNT = 16;

/**
 * La clave de idempotencia de la reserva sale de la llamada y de la orden, que son las que pone el proveedor:
 * si reintenta la misma orden la clave es la misma y la base de datos no deja crear una segunda reserva.
 * Un UUID derivado (no aleatorio) porque la columna es `uuid`.
 */
export function deriveBookingIdempotencyKey(providerCallId: string, toolCallId: string): string {
  const digest = createHash('sha256').update(`${providerCallId}\n${toolCallId}`).digest();
  const bytes = Buffer.from(digest.subarray(0, UUID_BYTE_COUNT));
  bytes[6] = ((bytes[6] ?? 0) & UUID_VERSION_CLEAR_MASK) | UUID_VERSION_FIVE_MASK;
  bytes[8] = ((bytes[8] ?? 0) & UUID_VARIANT_CLEAR_MASK) | UUID_VARIANT_MASK;
  return bytes.toString('hex').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
}
