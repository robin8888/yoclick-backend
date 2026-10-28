import { z } from 'zod';

const MIN_TCP_PORT = 1;
const MAX_TCP_PORT = 65_535;
const DEFAULT_PORT = 3000;
const DEFAULT_WAITLIST_SWEEP_INTERVAL_SECONDS = 60;
const DEFAULT_AUTO_START_INTERVAL_SECONDS = 30;
const DEFAULT_VOICE_TRANSCRIPT_SWEEP_INTERVAL_SECONDS = 3600;
const DEFAULT_VOICE_OVERAGE_REPORT_INTERVAL_SECONDS = 300;
const DEFAULT_VOICE_CENTER_CODE_FAILURES_PER_HOUR = 20;
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

/** Una variable en blanco del .env (`CLAVE=`) cuenta como no puesta. */
const optionalSetting = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().min(1).optional(),
);

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
  // Clave de Geoapify (sugerencias de direcciones). Obligatoria en todos los entornos: desarrollo y producción
  // usan el mismo proveedor. Plan gratuito en myprojects.geoapify.com.
  GEOAPIFY_API_KEY: z.string().min(1),
  // Comprueba contraseñas contra filtraciones conocidas (k-anonymity, SEC-43). Solo se apaga sin red.
  PASSWORD_BREACH_CHECK: z.enum(['enabled', 'disabled']).default('enabled'),
  // Límite de peticiones por IP (SEC-46, SEC-50). Solo se apaga en tests; en producción es obligatorio.
  RATE_LIMITING: z.enum(['enabled', 'disabled']).default('enabled'),
  // Avisos al móvil: `expo` los entrega por el servicio de Expo; `console` solo los anota en el log.
  PUSH_PROVIDER: z.enum(['console', 'expo']).default('console'),
  // Opcional: solo si el proyecto de Expo exige token de acceso para enviar.
  EXPO_ACCESS_TOKEN: z.string().min(1).optional(),
  // Vídeo: `bunny` los aloja en Bunny Stream; `fake` no llama a nadie (desarrollo y tests).
  VIDEO_PROVIDER: z.enum(['fake', 'bunny']).default('fake'),
  // Solo hacen falta con VIDEO_PROVIDER=bunny (se exigen en ese caso, ver más abajo).
  BUNNY_STREAM_LIBRARY_ID: z.string().min(1).optional(),
  BUNNY_STREAM_API_KEY: z.string().min(1).optional(),
  BUNNY_STREAM_TOKEN_KEY: z.string().min(1).optional(),
  // `enabled` firma los enlaces de reproducción (hay que activar Token Authentication en el pull zone de la
  // librería y usar su clave); `disabled` los deja sin firmar, que es lo único que acepta un CDN sin esa protección.
  BUNNY_STREAM_TOKEN_AUTH: z.enum(['enabled', 'disabled']).default('disabled'),
  // Dominio de reproducción de la librería, p. ej. vz-1234abcd-xyz.b-cdn.net
  BUNNY_STREAM_CDN_HOSTNAME: z.string().min(1).optional(),
  // Documentos (PDF): `bunny` los guarda en Bunny Storage; `fake` los guarda en memoria (desarrollo y tests).
  FILE_STORAGE_PROVIDER: z.enum(['fake', 'bunny']).default('fake'),
  // Solo hacen falta con FILE_STORAGE_PROVIDER=bunny (se exigen en ese caso, ver más abajo).
  BUNNY_STORAGE_ZONE: z.string().min(1).optional(),
  BUNNY_STORAGE_API_KEY: z.string().min(1).optional(),
  // Dominio del pull zone conectado a la zona de almacenamiento, p. ej. yoclick-files-cdn.b-cdn.net
  BUNNY_STORAGE_CDN_HOSTNAME: z.string().min(1).optional(),
  // Servidor de la región de la zona; el de Falkenstein (Alemania) es el de por defecto.
  BUNNY_STORAGE_HOST: z.string().min(1).default('storage.bunnycdn.com'),
  BUNNY_STORAGE_TOKEN_KEY: z.string().min(1).optional(),
  // `enabled` firma los enlaces de descarga (hay que activar Token Authentication en el pull zone y usar su
  // clave); `disabled` los deja sin firmar, que es lo único que acepta un CDN sin esa protección.
  BUNNY_STORAGE_TOKEN_AUTH: z.enum(['enabled', 'disabled']).default('disabled'),
  // Cada cuántos segundos se pasa la plaza a la siguiente persona de la lista de espera cuando vence una oferta; 0 lo apaga.
  WAITLIST_SWEEP_INTERVAL_SECONDS: z.coerce
    .number()
    .int()
    .min(0)
    .default(DEFAULT_WAITLIST_SWEEP_INTERVAL_SECONDS),
  // Cada cuántos segundos se inician solas las clases y citas que han llegado a su hora (centros que lo activan); 0 lo apaga.
  AUTO_START_INTERVAL_SECONDS: z.coerce
    .number()
    .int()
    .min(0)
    .default(DEFAULT_AUTO_START_INTERVAL_SECONDS),
  // Contestador IA de citas (add-on): `vapi` atiende de verdad; `fake` es para desarrollo y tests.
  VOICE_PROVIDER: z.enum(['fake', 'vapi']).default('fake'),
  // Secreto compartido con Vapi: viaja en la cabecera X-Vapi-Secret de cada aviso. Obligatorio con VOICE_PROVIDER=vapi.
  VOICE_WEBHOOK_SECRET: optionalSetting,
  // Cada cuántos segundos se borran las transcripciones que han cumplido la retención de su centro; 0 lo apaga.
  VOICE_TRANSCRIPT_SWEEP_INTERVAL_SECONDS: z.coerce
    .number()
    .int()
    .min(0)
    .default(DEFAULT_VOICE_TRANSCRIPT_SWEEP_INTERVAL_SECONDS),
  // Cada cuántos segundos se reintenta comunicar a Stripe el exceso de minutos que no llegó a comunicarse al
  // terminar la llamada; 0 lo apaga.
  VOICE_OVERAGE_REPORT_INTERVAL_SECONDS: z.coerce
    .number()
    .int()
    .min(0)
    .default(DEFAULT_VOICE_OVERAGE_REPORT_INTERVAL_SECONDS),
  // Códigos de alumno erróneos que admite todo un centro en una hora (con cualquier número) antes de que el
  // contestador pase a una persona sin probar más códigos.
  VOICE_CENTER_CODE_FAILURES_PER_HOUR: z.coerce
    .number()
    .int()
    .min(1)
    .default(DEFAULT_VOICE_CENTER_CODE_FAILURES_PER_HOUR),
  // Cobros de bonos y alquileres (plan Premium): `stripe` usa Stripe Connect; `fake` no llama a nadie.
  PAYMENT_PROVIDER: z.enum(['fake', 'stripe']).default('fake'),
  // Solo hacen falta con PAYMENT_PROVIDER=stripe (se exigen en ese caso, ver más abajo).
  STRIPE_SECRET_KEY: optionalSetting,
  // Sin él los avisos de Stripe se rechazan y los cobros se confirman solo desde la app.
  STRIPE_WEBHOOK_SECRET: optionalSetting,
  // Webhook de eventos Connect: los cobros directos del centro se avisan por aquí, no por el anterior.
  STRIPE_CONNECT_WEBHOOK_SECRET: optionalSetting,
  // Clave pública: la app la recibe de la API al pagar, así que no vive en su configuración.
  STRIPE_PUBLISHABLE_KEY: optionalSetting,
  // A dónde vuelve el navegador tras el alta de cobros del centro en Stripe (Stripe pide https).
  STRIPE_CONNECT_RETURN_URL: z.url().default('https://yoclick.app/stripe/return'),
  STRIPE_CONNECT_REFRESH_URL: z.url().default('https://yoclick.app/stripe/refresh'),
  // A dónde vuelve el navegador tras pagar el plan del centro en Stripe Checkout (Stripe pide https).
  BILLING_SUCCESS_URL: z.url().default('https://yoclick.app/billing/success'),
  BILLING_CANCEL_URL: z.url().default('https://yoclick.app/billing/cancel'),
  // A dónde vuelve el navegador al salir del portal de cliente de Stripe.
  BILLING_PORTAL_RETURN_URL: z.url().default('https://yoclick.app/billing/return'),
  // Cada cuántos segundos se abre la gracia de las pruebas acabadas sin plan y se suspende a quien agota
  // la gracia; 0 (por defecto) lo apaga, para no suspender centros de pruebas sin querer.
  BILLING_SWEEP_INTERVAL_SECONDS: z.coerce.number().int().min(0).default(0),
  // Dirección pública de la API: los correos de pago del plan llevan un enlace firmado que cuelga de ella.
  // En producción tiene que ser https.
  PUBLIC_API_URL: z.url().default('http://localhost:3000'),
  // Cada cuántos segundos se envían los correos de pago del plan (avisos de fin de prueba a los 7, 3 y 1 días
  // y al acabar); 0 (por defecto) los apaga, para no escribir a centros de pruebas sin querer.
  PLAN_PAYMENT_EMAIL_INTERVAL_SECONDS: z.coerce.number().int().min(0).default(0),
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

/** Los proveedores de correo y de avisos push: en producción no puede quedarse el de desarrollo. */
function listProviderRequirements(environment: ParsedEnvironment): ProductionRequirement[] {
  return [
    {
      isMet: environment.EMAIL_PROVIDER !== 'console',
      path: 'EMAIL_PROVIDER',
      message: 'must be a real provider in production: the console one only prints',
    },
    {
      isMet: environment.PUSH_PROVIDER !== 'console',
      path: 'PUSH_PROVIDER',
      message: 'must be a real provider in production: the console one only logs',
    },
    {
      isMet: environment.VIDEO_PROVIDER !== 'fake',
      path: 'VIDEO_PROVIDER',
      message: 'must be a real provider in production: the fake one stores nothing',
    },
  ];
}

/** Las direcciones que salen en correos y redirecciones: en producción tienen que ser https. */
function listPublicUrlRequirements(environment: ParsedEnvironment): ProductionRequirement[] {
  return [
    {
      isMet: environment.PUBLIC_API_URL.startsWith('https://'),
      path: 'PUBLIC_API_URL',
      message: 'must be an https URL in production: the payment links in emails point to it',
    },
  ];
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
    ...listProviderRequirements(environment),
    ...listPublicUrlRequirements(environment),
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

const BUNNY_SETTINGS = [
  'BUNNY_STREAM_LIBRARY_ID',
  'BUNNY_STREAM_API_KEY',
  'BUNNY_STREAM_CDN_HOSTNAME',
] as const;

/** Con Bunny hacen falta sus cuatro valores; con `fake` no. */
function listVideoProviderRequirements(environment: ParsedEnvironment): ProductionRequirement[] {
  if (environment.VIDEO_PROVIDER !== 'bunny') return [];
  const requirements: ProductionRequirement[] = BUNNY_SETTINGS.map((path) => ({
    isMet: environment[path] !== undefined,
    path,
    message: 'is required when VIDEO_PROVIDER=bunny',
  }));
  if (environment.BUNNY_STREAM_TOKEN_AUTH === 'enabled') {
    requirements.push({
      isMet: environment.BUNNY_STREAM_TOKEN_KEY !== undefined,
      path: 'BUNNY_STREAM_TOKEN_KEY',
      message: 'is required when BUNNY_STREAM_TOKEN_AUTH=enabled',
    });
  }
  return requirements;
}

const BUNNY_STORAGE_SETTINGS = [
  'BUNNY_STORAGE_ZONE',
  'BUNNY_STORAGE_API_KEY',
  'BUNNY_STORAGE_CDN_HOSTNAME',
] as const;

/** Con Bunny Storage hacen falta sus tres valores; con `fake` no. */
function listFileStorageRequirements(environment: ParsedEnvironment): ProductionRequirement[] {
  if (environment.FILE_STORAGE_PROVIDER !== 'bunny') return [];
  const requirements: ProductionRequirement[] = BUNNY_STORAGE_SETTINGS.map((path) => ({
    isMet: environment[path] !== undefined,
    path,
    message: 'is required when FILE_STORAGE_PROVIDER=bunny',
  }));
  if (environment.BUNNY_STORAGE_TOKEN_AUTH === 'enabled') {
    requirements.push({
      isMet: environment.BUNNY_STORAGE_TOKEN_KEY !== undefined,
      path: 'BUNNY_STORAGE_TOKEN_KEY',
      message: 'is required when BUNNY_STORAGE_TOKEN_AUTH=enabled',
    });
  }
  return requirements;
}

const STRIPE_SETTINGS = [
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_PUBLISHABLE_KEY',
] as const;

/** Con Stripe hacen falta sus dos claves; con `fake` no. */
function listPaymentProviderRequirements(environment: ParsedEnvironment): ProductionRequirement[] {
  if (environment.PAYMENT_PROVIDER !== 'stripe') return [];
  return STRIPE_SETTINGS.map((path) => ({
    isMet: environment[path] !== undefined,
    path,
    message: 'is required when PAYMENT_PROVIDER=stripe',
  }));
}

/** Con Vapi hace falta el secreto de los avisos; con `fake` no. */
function listVoiceProviderRequirements(environment: ParsedEnvironment): ProductionRequirement[] {
  if (environment.VOICE_PROVIDER !== 'vapi') return [];
  return [
    {
      isMet: environment.VOICE_WEBHOOK_SECRET !== undefined,
      path: 'VOICE_WEBHOOK_SECRET',
      message: 'is required when VOICE_PROVIDER=vapi',
    },
  ];
}

export const environmentSchema = baseEnvironmentSchema.superRefine((environment, context) => {
  const isProduction = environment.NODE_ENV === 'production';
  const requirements = [
    ...listEmailProviderRequirements(environment),
    ...listPaymentProviderRequirements(environment),
    ...listVoiceProviderRequirements(environment),
    ...listVideoProviderRequirements(environment),
    ...listFileStorageRequirements(environment),
    ...(isProduction ? listProductionRequirements(environment) : []),
  ];

  for (const requirement of requirements) {
    if (!requirement.isMet) {
      context.addIssue({ code: 'custom', path: [requirement.path], message: requirement.message });
    }
  }
});

export type Environment = z.infer<typeof environmentSchema>;
