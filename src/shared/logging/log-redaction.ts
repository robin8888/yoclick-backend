const REDACTED_KEYS = [
  'password',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'secret',
  'authorization',
  'cookie',
  'email',
  'phone',
  'health',
];

/** Cubre la clave en la raíz y a un nivel (`user.email`, `client.health`) — SEC-72. */
const REDACTED_PATHS = REDACTED_KEYS.flatMap((key) => [key, `*.${key}`]);

export const LOG_REDACTION = { paths: REDACTED_PATHS, censor: '[REDACTED]' };

export interface LoggableRequest {
  id?: unknown;
  method?: string | undefined;
  url?: string | undefined;
  headers?: Record<string, unknown>;
}

export interface SerializedRequest {
  id: unknown;
  method: string | undefined;
  path: string;
}

/**
 * Solo id, método y ruta. Sin cabeceras ni cuerpo (llevan credenciales) y sin
 * query string (puede llevar tokens o emails).
 */
export function serializeRequestForLog(request: LoggableRequest): SerializedRequest {
  const [path = ''] = (request.url ?? '').split('?');
  return { id: request.id, method: request.method, path };
}
