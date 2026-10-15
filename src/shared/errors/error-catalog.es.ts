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
  MFA_CODE_INVALID: { title: 'El código no es válido o ha caducado' },
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
  ROOM_UNAVAILABLE: {
    title: 'Esa sala no está libre a esa hora o no la da esa persona. Elige otra',
  },
  SESSION_FULL: { title: 'Esta clase ya no tiene plazas' },
  STAFF_NOT_FOR_SERVICE: {
    title: 'Esa persona no da este servicio. Elige a una de las que lo dan',
  },
  ROOM_SCHEDULE_OVERLAP: {
    title:
      'Esa sala ya tiene un horario a esa hora en esos días. Elige otra hora, otra fecha u otra sala',
  },
  TEACHER_SCHEDULE_OVERLAP: {
    title:
      'Esa persona ya da otra clase a esa hora en esos días. Elige otra hora, otra fecha u otra persona',
  },
  CLIENT_HAS_NO_PASS: {
    title:
      'Esa persona no tiene un bono en vigor con clases. Dale un bono desde su ficha para apuntarla',
  },
  PASS_FULLY_BOOKED: {
    title:
      'Ya tienes agendadas todas las clases de tu bono. Cancela alguna o pide otro bono para agendar más',
  },
  SERVICE_ONLY_IN_SCHEDULE: {
    title: 'Este servicio solo se da en sus horarios. Elige una de sus clases con plazas',
  },
  SESSION_MODE_NOT_ALLOWED: {
    title: 'Este servicio no se da de esa forma (privada o en grupo). Cámbialo en el servicio',
  },
  SCHEDULE_HAS_BOOKINGS: {
    title: 'Hay citas sueltas en sesiones futuras de este horario. Cancélalas o muévelas antes',
  },
  SESSION_NOT_CANCELLABLE: { title: 'Esta sesión ya ha empezado o ya estaba cancelada' },
  ROOM_HAS_BOOKINGS: {
    title: 'Hay clases o citas en ese tramo. Cancélalas o muévelas antes de bloquear la sala',
  },
  PAYMENTS_NOT_INCLUDED: { title: 'El plan de este centro no incluye cobros online' },
  CENTER_CONTACT_EMAIL_REQUIRED: {
    title: 'Añade un email de contacto al centro para activar los cobros online',
  },
  PAYMENTS_NOT_READY: {
    title: 'Este centro aún no puede cobrar online. Pídele que complete el alta de cobros',
  },
  CHAT_NOT_ALLOWED: { title: 'No puedes escribir a esta persona' },
  CHAT_MINOR_REQUIRES_GUARDIAN: {
    title: 'A los menores solo se les escribe a través de su tutor',
  },
  CHAT_ATTACHMENT_UNSUPPORTED: { title: 'Solo se pueden enviar imágenes (JPEG, PNG, WebP) o PDF' },
  CHAT_ATTACHMENT_TOO_LARGE: {
    title: 'El archivo es demasiado grande. Máximo 5 MB en imágenes y 10 MB en PDF',
  },
  BOOKING_NOT_CANCELLABLE: { title: 'Esta reserva ya no se puede cancelar' },
  BOOKING_NOT_RESCHEDULABLE: { title: 'Esta reserva ya no se puede cambiar de hora' },
  RESCHEDULE_TOO_LATE: {
    title: 'Ya no queda antelación para cambiar la hora. Habla con el centro',
  },
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
  TIME_ENTRY_OVERLAP: { title: 'Ese horario se solapa con otro turno que ya tienes registrado' },
  TIME_ENTRY_INVALID_RANGE: { title: 'La salida tiene que ser posterior a la entrada' },
  TIME_ENTRY_TOO_LONG: { title: 'Un turno no puede durar más de 16 horas' },
  TIME_ENTRY_IN_FUTURE: { title: 'No se puede registrar una hora que aún no ha llegado' },
  PREMIUM_APPEARANCE_NOT_INCLUDED: {
    title: 'Personalizar el fondo y la colmena es del plan Premium',
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
  DOCUMENT_NOT_PDF: { title: 'El fichero no es un PDF válido' },
  DOCUMENT_TOO_LARGE: { title: 'El PDF es demasiado grande. Máximo 50 MB' },
  DOCUMENT_QUOTA_EXCEEDED: {
    title: 'El centro ha llenado su espacio de documentos. Borra alguno o amplía el plan',
  },
  PHOTO_NOT_IMAGE: { title: 'La foto tiene que ser una imagen JPEG, PNG o WebP' },
  PHOTO_TOO_LARGE: { title: 'La foto es demasiado grande. Máximo 5 MB' },
  PROFILE_PHOTO_LIMIT_REACHED: {
    title: 'Ya tienes seis fotos en tu perfil. Borra una para subir otra',
  },
  PHOTO_QUOTA_EXCEEDED: {
    title: 'Tu centro ha llenado su espacio de fotos. Quita alguna para poder subir otra',
  },
  VIDEO_UPLOADS_IN_PROGRESS: {
    title: 'Tu centro ya tiene varios vídeos subiéndose. Espera a que terminen para subir otro',
  },
  CONTENT_VIDEO_ALREADY_IN_LIBRARY: { title: 'Este vídeo ya está en la biblioteca' },
  CONTENT_ASSIGNMENT_INVALID: {
    title: 'A quién se asigna el contenido no existe en este centro',
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
