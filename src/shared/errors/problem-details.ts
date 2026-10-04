import { ERROR_CATALOG, type ErrorCode } from './error-catalog.es';

const ERROR_TYPE_BASE_URL = 'https://api.yoclick.app/errors';

export interface ProblemFieldError {
  readonly path: string;
  readonly code: string;
}

/** RFC 9457 Problem Details, con el `code` estable y el `traceId` que pide docs/spec/03-api.md. */
export interface ProblemDetails {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly code: ErrorCode;
  readonly traceId: string;
  readonly errors?: readonly ProblemFieldError[];
}

interface BuildProblemInput {
  readonly code: ErrorCode;
  readonly status: number;
  readonly traceId: string;
  readonly errors?: readonly ProblemFieldError[];
}

function toKebabCase(code: string): string {
  return code.toLowerCase().replaceAll('_', '-');
}

export function buildProblemDetails(input: BuildProblemInput): ProblemDetails {
  return {
    type: `${ERROR_TYPE_BASE_URL}/${toKebabCase(input.code)}`,
    title: ERROR_CATALOG[input.code].title,
    status: input.status,
    code: input.code,
    traceId: input.traceId,
    ...(input.errors && { errors: input.errors }),
  };
}
