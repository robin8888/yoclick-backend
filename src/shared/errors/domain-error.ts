import { type ErrorCode } from './error-catalog.es';
import { type ProblemFieldError } from './problem-details';

/**
 * Error de negocio con un `code` estable del catálogo. Los módulos lo extienden con errores
 * nombrados (`SlotUnavailableError`); un filtro global lo convierte a RFC 9457.
 * Nunca se lanza `new Error('...')` genérico desde el dominio.
 *
 * `fieldErrors` indica qué campo falla y por qué (solo ruta y código, nunca el valor rechazado).
 */
export class DomainError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly httpStatus: number,
    readonly fieldErrors?: readonly ProblemFieldError[],
  ) {
    super(code);
    this.name = new.target.name;
  }
}
