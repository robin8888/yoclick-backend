import { z } from 'zod';

const MIN_TCP_PORT = 1;
const MAX_TCP_PORT = 65_535;
const DEFAULT_PORT = 3000;
const DEVELOPMENT_KEY_ID = 'dev-1';
const MIN_PEPPER_BYTES = 32;
const MFA_KEY_BYTES = 32;

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

const baseEnvironmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  // En contenedor hay que poner 0.0.0.0 de forma explícita; por defecto no se expone a la red.
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(MIN_TCP_PORT).max(MAX_TCP_PORT).default(DEFAULT_PORT),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  // Rol yoclick_app (sin BYPASSRLS ni DDL). El rol de migraciones NO se lee en runtime (SEC-63).
  DATABASE_URL: z
    .string()
    .refine((value) => parseDatabaseUrl(value) !== null, 'must be a postgresql:// URL'),
  // Par de claves Ed25519 (PEM en base64). La privada firma los tokens de acceso; solo la API la tiene.
  JWT_ACCESS_PRIVATE_KEY_BASE64: z.string().min(1),
  JWT_ACCESS_PUBLIC_KEY_BASE64: z.string().min(1),
  // Identifica la clave en el token (`kid`) para poder rotarla sin cortar sesiones.
  JWT_KEY_ID: z.string().min(1).default(DEVELOPMENT_KEY_ID),
  // Clave secreta con la que se firman (HMAC) los códigos de 6 dígitos antes de guardarlos: sin ella,
  // una filtración de la base de datos permitiría probar el millón de códigos posibles sin límite.
  AUTH_CODE_PEPPER_BASE64: z
    .string()
    .refine(
      (value) => Buffer.from(value, 'base64').length >= MIN_PEPPER_BYTES,
      `must decode to at least ${String(MIN_PEPPER_BYTES)} bytes`,
    ),
  // Clave AES-256 con la que se cifran los secretos TOTP antes de guardarlos (SEC-70). Exactamente 32 bytes.
  MFA_ENCRYPTION_KEY_BASE64: z
    .string()
    .refine(
      (value) => Buffer.from(value, 'base64').length === MFA_KEY_BYTES,
      `must decode to exactly ${String(MFA_KEY_BYTES)} bytes`,
    ),
  // Comprueba contraseñas contra filtraciones conocidas (k-anonymity, SEC-43). Solo se apaga sin red.
  PASSWORD_BREACH_CHECK: z.enum(['enabled', 'disabled']).default('enabled'),
  // Límite de peticiones por IP (SEC-46, SEC-50). Solo se apaga en tests; en producción es obligatorio.
  RATE_LIMITING: z.enum(['enabled', 'disabled']).default('enabled'),
  EMAIL_PROVIDER: z.enum(['console', 'brevo']).default('console'),
  // Solo hacen falta con EMAIL_PROVIDER=brevo (se exigen en ese caso, ver más abajo).
  BREVO_API_KEY: z.string().min(1).optional(),
  EMAIL_FROM_ADDRESS: z.email().optional(),
  EMAIL_FROM_NAME: z.string().min(1).default('Yoclick'),
  // Los buzones de usar y tirar (yopmail...) sirven para probar, pero en producción dejan sin
  // comprobar que haya una persona detrás de la cuenta.
  ALLOW_DISPOSABLE_EMAILS: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});

type ParsedEnvironment = z.infer<typeof baseEnvironmentSchema>;

interface ProductionRequirement {
  readonly isMet: boolean;
  readonly path: string;
  readonly message: string;
}

/** Lo que en desarrollo se tolera y en producción hace que el proceso no arranque. */
function listProductionRequirements(environment: ParsedEnvironment): ProductionRequirement[] {
  const sslMode = parseDatabaseUrl(environment.DATABASE_URL)?.searchParams.get('sslmode') ?? '';
  return [
    {
      isMet: !VERBOSE_LOG_LEVELS.includes(environment.LOG_LEVEL),
      path: 'LOG_LEVEL',
      message: 'must be info or higher in production (verbose logs can leak data)',
    },
    {
      isMet: environment.JWT_KEY_ID !== DEVELOPMENT_KEY_ID,
      path: 'JWT_KEY_ID',
      message: 'must not be the development key id in production',
    },
    {
      isMet: TLS_ENFORCING_SSL_MODES.includes(sslMode),
      path: 'DATABASE_URL',
      message: 'must enforce TLS in production (sslmode=require, verify-ca or verify-full)',
    },
    {
      isMet: environment.RATE_LIMITING === 'enabled',
      path: 'RATE_LIMITING',
      message: 'must be enabled in production',
    },
    {
      isMet: environment.PASSWORD_BREACH_CHECK === 'enabled',
      path: 'PASSWORD_BREACH_CHECK',
      message: 'must be enabled in production',
    },
    {
      isMet: environment.EMAIL_PROVIDER !== 'console',
      path: 'EMAIL_PROVIDER',
      message: 'must be a real provider in production: the console one only prints',
    },
    {
      isMet: !environment.ALLOW_DISPOSABLE_EMAILS,
      path: 'ALLOW_DISPOSABLE_EMAILS',
      message: 'must be off in production',
    },
  ];
}

/** Con proveedor real hacen falta sus credenciales; con `console` no. */
function listEmailProviderRequirements(environment: ParsedEnvironment): ProductionRequirement[] {
  if (environment.EMAIL_PROVIDER !== 'brevo') return [];
  return [
    {
      isMet: environment.BREVO_API_KEY !== undefined,
      path: 'BREVO_API_KEY',
      message: 'is required when EMAIL_PROVIDER=brevo',
    },
    {
      isMet: environment.EMAIL_FROM_ADDRESS !== undefined,
      path: 'EMAIL_FROM_ADDRESS',
      message: 'is required when EMAIL_PROVIDER=brevo',
    },
  ];
}

export const environmentSchema = baseEnvironmentSchema.superRefine((environment, context) => {
  const isProduction = environment.NODE_ENV === 'production';
  const requirements = [
    ...listEmailProviderRequirements(environment),
    ...(isProduction ? listProductionRequirements(environment) : []),
  ];

  for (const requirement of requirements) {
    if (!requirement.isMet) {
      context.addIssue({ code: 'custom', path: [requirement.path], message: requirement.message });
    }
  }
});

export type Environment = z.infer<typeof environmentSchema>;
