import { HttpException } from '@nestjs/common';
import { ZodValidationException } from 'nestjs-zod';
import { DomainError } from './domain-error';
import { type ErrorCode } from './error-catalog.es';
import {
  buildProblemDetails,
  type ProblemDetails,
  type ProblemFieldError,
} from './problem-details';

const HTTP_STATUS_BAD_REQUEST = 400;
const HTTP_STATUS_INTERNAL_ERROR = 500;
const FIRST_CLIENT_ERROR_STATUS = 400;
const FIRST_SERVER_ERROR_STATUS = 500;

const ERROR_CODE_BY_HTTP_STATUS: Readonly<Record<number, ErrorCode>> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  409: 'CONFLICT',
  412: 'PRECONDITION_FAILED',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  428: 'PRECONDITION_REQUIRED',
  429: 'RATE_LIMITED',
};

function isClientErrorStatus(status: number): boolean {
  return status >= FIRST_CLIENT_ERROR_STATUS && status < FIRST_SERVER_ERROR_STATUS;
}

/** Errores de Fastify (cuerpo demasiado grande, JSON mal formado...) traen `statusCode`. */
function readFastifyStatusCode(exception: unknown): number | undefined {
  if (!(exception instanceof Error)) return undefined;
  const statusCode: unknown = (exception as { statusCode?: unknown }).statusCode;
  return typeof statusCode === 'number' && isClientErrorStatus(statusCode) ? statusCode : undefined;
}

function mapStatusToProblem(status: number, traceId: string): ProblemDetails {
  const code = ERROR_CODE_BY_HTTP_STATUS[status] ?? 'BAD_REQUEST';
  return buildProblemDetails({ code, status, traceId });
}

function mapZodValidationToProblem(
  exception: ZodValidationException,
  traceId: string,
): ProblemDetails {
  const zodError = exception.getZodError() as {
    issues: readonly { path: PropertyKey[]; code: string }[];
  };
  // Solo ruta y código del fallo: el valor rechazado puede ser una contraseña o un dato personal.
  const errors: ProblemFieldError[] = zodError.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    code: issue.code,
  }));
  return buildProblemDetails({
    code: 'VALIDATION_FAILED',
    status: HTTP_STATUS_BAD_REQUEST,
    traceId,
    errors,
  });
}

/**
 * Traduce cualquier excepción a Problem Details (RFC 9457).
 *
 * El mensaje de la excepción NUNCA se copia a la respuesta: las excepciones de framework,
 * de base de datos y de librerías pueden revelar rutas, consultas o datos de otras personas.
 */
export function mapExceptionToProblem(exception: unknown, traceId: string): ProblemDetails {
  if (exception instanceof DomainError) {
    return buildProblemDetails({ code: exception.code, status: exception.httpStatus, traceId });
  }
  if (exception instanceof ZodValidationException) {
    return mapZodValidationToProblem(exception, traceId);
  }
  if (exception instanceof HttpException && isClientErrorStatus(exception.getStatus())) {
    return mapStatusToProblem(exception.getStatus(), traceId);
  }

  const fastifyStatusCode = readFastifyStatusCode(exception);
  if (fastifyStatusCode !== undefined) return mapStatusToProblem(fastifyStatusCode, traceId);

  return buildProblemDetails({
    code: 'INTERNAL_ERROR',
    status: HTTP_STATUS_INTERNAL_ERROR,
    traceId,
  });
}
