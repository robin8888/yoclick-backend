import { z } from 'zod';
import { DomainError } from '../errors/domain-error';
import { HTTP_STATUS } from '../errors/http-status';

const idempotencyKeySchema = z.uuid();

/**
 * La cabecera `Idempotency-Key` es obligatoria en reservas, pagos, cancelaciones y compras.
 * La genera la app (`expo-crypto.randomUUID()`) una vez por intención de la persona.
 */
export function parseIdempotencyKeyHeader(headerValue: string | string[] | undefined): string {
  const parsingResult = idempotencyKeySchema.safeParse(
    typeof headerValue === 'string' ? headerValue.trim() : undefined,
  );
  if (!parsingResult.success) {
    throw new DomainError('IDEMPOTENCY_KEY_REQUIRED', HTTP_STATUS.badRequest);
  }
  return parsingResult.data.toLowerCase();
}
