/**
 * Mensajes al usuario por `code`. La app traduce por `code`, nunca por `title`.
 * Tono: español de España, tuteo, sin culpar a quien lo lee.
 */
export const ERROR_CATALOG = {
  BAD_REQUEST: { title: 'La petición no es válida' },
  VALIDATION_FAILED: { title: 'Revisa los datos que has enviado' },
  UNAUTHENTICATED: { title: 'Tienes que iniciar sesión' },
  FORBIDDEN: { title: 'No tienes permiso para hacer esto' },
  NOT_FOUND: { title: 'No encontramos lo que buscas' },
  METHOD_NOT_ALLOWED: { title: 'Esa acción no está disponible aquí' },
  CONFLICT: { title: 'Esto choca con el estado actual' },
  PAYLOAD_TOO_LARGE: { title: 'El contenido enviado es demasiado grande' },
  UNSUPPORTED_MEDIA_TYPE: { title: 'No admitimos ese tipo de contenido' },
  PRECONDITION_FAILED: { title: 'Alguien ha cambiado esto antes que tú' },
  PRECONDITION_REQUIRED: { title: 'Falta indicar la versión que quieres modificar' },
  IDEMPOTENCY_KEY_REQUIRED: { title: 'Falta la clave de idempotencia de esta operación' },
  IDEMPOTENCY_KEY_REUSED: { title: 'Esa clave ya se usó con otra petición distinta' },
  IDEMPOTENCY_IN_PROGRESS: { title: 'Esta operación ya se está procesando' },
  RATE_LIMITED: { title: 'Demasiados intentos. Espera un momento y vuelve a probar' },
  INTERNAL_ERROR: { title: 'Algo ha fallado de nuestro lado. Inténtalo de nuevo' },
} as const;

export type ErrorCode = keyof typeof ERROR_CATALOG;
