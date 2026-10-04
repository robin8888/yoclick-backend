import { z } from 'zod';

const MIN_TCP_PORT = 1;
const MAX_TCP_PORT = 65_535;
const DEFAULT_PORT = 3000;

const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'] as const;
const VERBOSE_LOG_LEVELS: readonly string[] = ['trace', 'debug'];
const TLS_ENFORCING_SSL_MODES: readonly string[] = ['require', 'verify-ca', 'verify-full'];

function parseDatabaseUrl(connectionString: string): URL | null {
  try {
    const databaseUrl = new URL(connectionString);
    const isPostgresProtocol = ['postgresql:', 'postgres:'].includes(databaseUrl.protocol);
    return isPostgresProtocol ? databaseUrl : null;
  } catch {
    return null;
  }
}

export const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    // En contenedor hay que poner 0.0.0.0 de forma explícita; por defecto no se expone a la red.
    HOST: z.string().min(1).default('127.0.0.1'),
    PORT: z.coerce.number().int().min(MIN_TCP_PORT).max(MAX_TCP_PORT).default(DEFAULT_PORT),
    LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
    // Rol yoclick_app (sin BYPASSRLS ni DDL). El rol de migraciones NO se lee en runtime (SEC-63).
    DATABASE_URL: z
      .string()
      .refine((value) => parseDatabaseUrl(value) !== null, 'must be a postgresql:// URL'),
  })
  .superRefine((environment, context) => {
    const isProduction = environment.NODE_ENV === 'production';
    if (!isProduction) return;

    if (VERBOSE_LOG_LEVELS.includes(environment.LOG_LEVEL)) {
      context.addIssue({
        code: 'custom',
        path: ['LOG_LEVEL'],
        message: 'must be info or higher in production (verbose logs can leak data)',
      });
    }

    const sslMode = parseDatabaseUrl(environment.DATABASE_URL)?.searchParams.get('sslmode') ?? '';
    if (!TLS_ENFORCING_SSL_MODES.includes(sslMode)) {
      context.addIssue({
        code: 'custom',
        path: ['DATABASE_URL'],
        message: 'must enforce TLS in production (sslmode=require, verify-ca or verify-full)',
      });
    }
  });

export type Environment = z.infer<typeof environmentSchema>;
