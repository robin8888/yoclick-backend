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
  CONSENT_REQUIRED: { title: 'Tienes que aceptar la política de privacidad y los términos' },
  EMAIL_DOMAIN_NOT_ALLOWED: {
    title: 'Ese tipo de correo no está permitido. Usa tu correo personal',
  },
  PASSWORD_BREACHED: { title: 'Esa contraseña aparece en filtraciones. Elige otra' },
  VERIFICATION_CODE_INVALID: { title: 'El código no es válido o ha caducado' },
  MFA_REQUIRED: {
    title: 'Esta acción exige verificación en dos pasos. Actívala e inicia sesión de nuevo',
  },
  MFA_CODE_INVALID: { title: 'El código no es válido' },
  MFA_ALREADY_ENABLED: { title: 'La verificación en dos pasos ya está activada' },
  MFA_NOT_ENABLED: { title: 'La verificación en dos pasos no está activada' },
  MFA_REQUIRED_FOR_ROLE: {
    title: 'Tu rol exige verificación en dos pasos: no se puede desactivar',
  },
  REAUTHENTICATION_FAILED: { title: 'La contraseña no es correcta' },
  ACCOUNT_OWNS_CENTER: {
    title: 'Antes de eliminar tu cuenta, cierra o traspasa el centro del que eres propietario',
  },
  INVALID_CREDENTIALS: { title: 'Correo o contraseña incorrectos' },
  EMAIL_NOT_VERIFIED: { title: 'Confirma tu correo para poder entrar' },
  ACCOUNT_LOCKED: { title: 'Demasiados intentos. Espera unos minutos y vuelve a probar' },
  SESSION_INVALID: { title: 'Tu sesión ha caducado. Inicia sesión de nuevo' },
  JOIN_CODE_INVALID: { title: 'Ese código no corresponde a ningún centro' },
  CLIENT_LIMIT_REACHED: { title: 'Este centro ha alcanzado su límite de clientes por ahora' },
  MEMBERSHIP_BLOCKED: { title: 'El centro no permite que te unas' },
  CENTER_LIMIT_REACHED: { title: 'Has alcanzado el máximo de centros que puedes gestionar' },
  ALREADY_MEMBER: { title: 'Esa persona ya forma parte del centro' },
  INVITATION_INVALID: { title: 'La invitación no es válida o ha caducado' },
  TEAM_CHANGE_NOT_ALLOWED: { title: 'No puedes hacer ese cambio en el equipo' },
  LOGO_INVALID: { title: 'El logo no es válido. Sube una imagen PNG, JPG o WebP' },
  LOGO_TOO_LARGE: { title: 'El logo es demasiado grande. Máximo 700 KB' },
  SLOT_UNAVAILABLE: { title: 'Ese hueco ya no está disponible. Elige otro' },
  OUTSIDE_BOOKING_WINDOW: { title: 'Ese día u hora todavía no se puede reservar' },
  ALREADY_BOOKED: { title: 'Ya tienes otra cita a esa hora' },
  BOOKING_NOT_CANCELLABLE: { title: 'Esta reserva ya no se puede cancelar' },
  BOOKING_NOT_STARTABLE: {
    title: 'Esta clase no se puede iniciar ahora: solo desde 15 minutos antes hasta que termina',
  },
  SESSION_ALREADY_OPEN: {
    title: 'Ya tienes otra clase en marcha. Termínala antes de iniciar esta',
  },
  SESSION_NOT_STARTED: { title: 'Esta clase todavía no se ha iniciado' },
  CHECKIN_CODE_INVALID: {
    title: 'Este código QR no es válido o ha caducado. Pide que lo actualicen',
  },
  CHECKIN_NO_BOOKING: {
    title: 'Esta persona no tiene una cita confirmada para registrar ahora',
  },
  VIDEO_NOT_INCLUDED: { title: 'El plan de este centro no incluye vídeo' },
  VIDEO_TOO_LARGE: { title: 'El vídeo es demasiado grande. Máximo 500 MB' },
  VIDEO_QUOTA_EXCEEDED: {
    title: 'El centro ha llenado su espacio de vídeo. Borra alguno o amplía el plan',
  },
  VIDEO_NOT_REVIEWABLE: { title: 'Este vídeo no está pendiente de revisión' },
  TECHNIQUE_VIDEO_LIMIT_REACHED: {
    title: 'Ya tienes tres vídeos de técnica. Borra uno para subir otro',
  },
  PRIVACY_REQUEST_ALREADY_OPEN: { title: 'Ya tienes una solicitud abierta de ese derecho' },
  PRIVACY_REQUEST_CLOSED: { title: 'Esta solicitud ya está resuelta' },
  PROFILE_CONSENT_REQUIRED: {
    title: 'Para enviar tu perfil tienes que autorizar que se publique tu imagen y tus vídeos',
  },
  PROFILE_EMPTY: { title: 'Añade algo a tu perfil antes de enviarlo' },
  PROFILE_NOT_REVIEWABLE: { title: 'Este perfil no está pendiente de revisión' },
  CERTIFICATION_LIMIT_REACHED: { title: 'Has llegado al máximo de titulaciones' },
  REVIEW_NOT_ALLOWED: {
    title:
      'Solo puedes opinar de una sesión que hayas tenido con esta persona, y una vez por sesión',
  },
  REVIEW_NOT_MODERABLE: { title: 'Esta opinión ya está revisada' },
  INTERNAL_ERROR: { title: 'Algo ha fallado de nuestro lado. Inténtalo de nuevo' },
} as const;

export type ErrorCode = keyof typeof ERROR_CATALOG;
