/**
 * El texto de cada aviso push. Es deliberadamente genérico: ni nombres, ni horas, ni servicios.
 * Un aviso se ve en la pantalla de bloqueo, y lo sensible solo debe estar dentro de la app (SEC-M5).
 */
export interface PushCopy {
  readonly title: string;
  readonly body: string;
}

const OPEN_APP_BODY = 'Abre la aplicación para ver los detalles.';

const COPY_BY_KIND: Readonly<Record<string, PushCopy>> = {
  booking_created: { title: 'Nueva cita', body: OPEN_APP_BODY },
  booking_cancelled: { title: 'Cita cancelada', body: OPEN_APP_BODY },
  booking_created_by_team: { title: 'Tienes una cita nueva', body: OPEN_APP_BODY },
  booking_cancelled_by_team: { title: 'Han cancelado una cita tuya', body: OPEN_APP_BODY },
  booking_rescheduled: { title: 'Cita cambiada de hora', body: OPEN_APP_BODY },
  booking_rescheduled_by_team: {
    title: 'Han cambiado la hora de una cita tuya',
    body: OPEN_APP_BODY,
  },
  absence_added: { title: 'Ausencia en el equipo', body: OPEN_APP_BODY },
  booking_affected_by_absence: { title: 'Tu cita puede cambiar', body: OPEN_APP_BODY },
  member_joined: { title: 'Alguien nuevo se ha unido', body: OPEN_APP_BODY },
  routine_updated: { title: 'Han actualizado una rutina tuya', body: OPEN_APP_BODY },
  routine_assigned: { title: 'Tienes una rutina nueva', body: OPEN_APP_BODY },
  content_assigned: { title: 'Tienes contenido nuevo', body: OPEN_APP_BODY },
  staff_video_submitted: { title: 'Hay un vídeo por revisar', body: OPEN_APP_BODY },
  staff_video_reviewed: { title: 'Han revisado tu vídeo', body: OPEN_APP_BODY },
  privacy_request_received: { title: 'Nueva solicitud de datos', body: OPEN_APP_BODY },
  staff_profile_submitted: { title: 'Hay un perfil por revisar', body: OPEN_APP_BODY },
  staff_profile_reviewed: { title: 'Han revisado tu perfil', body: OPEN_APP_BODY },
  staff_review_received: { title: 'Tienes una opinión nueva', body: OPEN_APP_BODY },
  privacy_request_resolved: { title: 'Han respondido a tu solicitud', body: OPEN_APP_BODY },
  session_cancelled: { title: 'Han cancelado una clase', body: OPEN_APP_BODY },
  schedule_enrolled: { title: 'Tienes un horario fijo nuevo', body: OPEN_APP_BODY },
  schedule_unenrolled: { title: 'Cambio en tu horario fijo', body: OPEN_APP_BODY },
  pass_requested: { title: 'Nueva solicitud de bono', body: OPEN_APP_BODY },
  pass_activated: { title: 'Tu bono está activo', body: OPEN_APP_BODY },
  room_rental_assigned: { title: 'Tienes un alquiler de sala', body: OPEN_APP_BODY },
  payment_received: { title: 'Has recibido un pago', body: OPEN_APP_BODY },
  pass_running_low: { title: 'Tu bono se está acabando', body: OPEN_APP_BODY },
  pass_exhausted: { title: 'Tu bono se ha agotado', body: OPEN_APP_BODY },
};

const FALLBACK_COPY: PushCopy = { title: 'Tienes un aviso nuevo', body: OPEN_APP_BODY };

export function getPushCopy(kind: string): PushCopy {
  return COPY_BY_KIND[kind] ?? FALLBACK_COPY;
}
