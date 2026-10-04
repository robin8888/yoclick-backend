import { type ErrorCode } from './error-catalog.es';

/**
 * Error de negocio con un `code` estable del catálogo. Los módulos lo extienden con errores
 * nombrados (`SlotUnavailableError`); un filtro global lo convierte a RFC 9457.
 * Nunca se lanza `new Error('...')` genérico desde el dominio.
 */
export class DomainError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly httpStatus: number,
  ) {
    super(code);
    this.name = new.target.name;
  }
}
