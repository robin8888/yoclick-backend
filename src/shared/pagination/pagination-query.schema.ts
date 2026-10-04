import { z } from 'zod';
import { MAX_CURSOR_LENGTH } from './cursor';

export const DEFAULT_PAGE_SIZE = 20;
/** SEC-50: ningún listado devuelve más de 100 filas por petición. */
export const MAX_PAGE_SIZE = 100;

/**
 * Campos de paginación para ampliar en el esquema ESTRICTO de cada endpoint:
 * `z.strictObject({ ...paginationQueryShape, staffId: z.uuid().optional() })`.
 * Los filtros son una lista blanca explícita por endpoint, nunca genéricos.
 */
export const paginationQueryShape = {
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  cursor: z.string().max(MAX_CURSOR_LENGTH).optional(),
};
