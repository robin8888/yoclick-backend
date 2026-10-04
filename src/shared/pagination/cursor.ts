import { type z } from 'zod';
import { DomainError } from '../errors/domain-error';
import { HTTP_STATUS } from '../errors/http-status';

export const MAX_CURSOR_LENGTH = 512;

function badCursor(): DomainError {
  return new DomainError('BAD_REQUEST', HTTP_STATUS.badRequest);
}

/** Cursor opaco para el cliente: la posición (keyset) serializada en base64url. */
export function encodeCursor(position: object): string {
  return Buffer.from(JSON.stringify(position)).toString('base64url');
}

/**
 * Un cursor manipulado solo puede apuntar a otra posición dentro de filas a las que la persona
 * ya tiene acceso (la RLS y el filtro por centro se aplican igual), pero aun así se valida
 * con un esquema estricto: longitud acotada, JSON válido y exactamente la forma esperada.
 */
export function decodeCursor<TPosition>(cursor: string, schema: z.ZodType<TPosition>): TPosition {
  if (cursor.length === 0 || cursor.length > MAX_CURSOR_LENGTH) throw badCursor();

  let decodedJson: unknown;
  try {
    decodedJson = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw badCursor();
  }

  const parsingResult = schema.safeParse(decodedJson);
  if (!parsingResult.success) throw badCursor();
  return parsingResult.data;
}
