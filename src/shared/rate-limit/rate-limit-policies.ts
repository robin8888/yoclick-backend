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
  /** Pedir el código del segundo factor por correo: además hay 60 s de enfriamiento por cuenta. */
  sendEmailCode: { limit: 5, ttl: ONE_MINUTE },
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
  /** Pedir el QR de asistencia: la app lo renueva cada pocos minutos mientras se enseña. */
  issueCheckinToken: { limit: 30, ttl: ONE_MINUTE },
  /** Escanear QR: quien atiende pasa a varias personas seguidas, nunca cientos por minuto. */
  checkInClient: { limit: 60, ttl: ONE_MINUTE },
  /** Ver y corregir los turnos propios: unas pocas veces al día. */
  manageTimeEntries: { limit: 30, ttl: ONE_MINUTE },
  /**
   * Subidas de ficheros (fotos, PDF, inicio de subida de vídeo): cada una cuesta almacenamiento y
   * tráfico de CDN. Una persona sube unas pocas al día; un bucle que llena el almacén no. Se suman al
   * tope de espacio por centro, que es el límite que de verdad acota la factura.
   */
  uploadPhoto: { limit: 10, ttl: ONE_MINUTE },
  uploadDocument: { limit: 10, ttl: ONE_MINUTE },
  startVideoUpload: { limit: 10, ttl: MILLISECONDS_PER_HOUR },
  /** Sugerencias de dirección: cada una llama a un tercero gratuito; la app pregunta al teclear, con espera. */
  searchAddress: { limit: 40, ttl: ONE_MINUTE },
  accountSecurity: { limit: 5, ttl: ONE_MINUTE },
} as const satisfies Record<string, RateLimitPolicy>;
