import { MILLISECONDS_PER_HOUR, MILLISECONDS_PER_MINUTE } from '../time/time-units';

export interface RateLimitPolicy {
  /** Peticiones permitidas por IP en la ventana. */
  readonly limit: number;
  /** Ventana en milisegundos. */
  readonly ttl: number;
}

const ONE_MINUTE = MILLISECONDS_PER_MINUTE;

/** Límite global por IP (SEC-50): un cliente normal no se acerca; un bucle sí. */
export const DEFAULT_RATE_LIMIT: RateLimitPolicy = { limit: 120, ttl: ONE_MINUTE };

/**
 * Límites por ruta, mucho más estrictos en lo que se puede explotar adivinando (SEC-46): contraseñas,
 * códigos de 6 dígitos y envío de correos. Se suman a los límites por cuenta (bloqueo tras 10 fallos,
 * 5 intentos por código y enfriamiento entre códigos), que protegen aunque el atacante cambie de IP.
 */
export const RATE_LIMITS = {
  login: { limit: 10, ttl: ONE_MINUTE },
  register: { limit: 5, ttl: ONE_MINUTE },
  forgotPassword: { limit: 5, ttl: ONE_MINUTE },
  resendVerification: { limit: 5, ttl: ONE_MINUTE },
  submitCode: { limit: 10, ttl: ONE_MINUTE },
  refreshSession: { limit: 30, ttl: ONE_MINUTE },
  /** Cambiar contraseña, exportar datos, eliminar la cuenta: lo que haría quien robara un token. */
  /** Dar de alta centros: poco frecuente y atractivo para el abuso. */
  createCenter: { limit: 5, ttl: ONE_MINUTE },
  /** Subir el logo: se hace una vez al dar de alta el centro y rara vez después. */
  uploadCenterLogo: { limit: 10, ttl: MILLISECONDS_PER_HOUR },
  /** Reservar: una persona normal reserva pocas citas por minuto; un bucle de reservas no. */
  createBooking: { limit: 20, ttl: ONE_MINUTE },
  /** Consultar huecos: la app lo pide al cambiar de día o de servicio. */
  queryAvailability: { limit: 60, ttl: ONE_MINUTE },
  accountSecurity: { limit: 5, ttl: ONE_MINUTE },
} as const satisfies Record<string, RateLimitPolicy>;
