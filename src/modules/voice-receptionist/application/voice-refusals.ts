import { DomainError } from '../../../shared/errors/domain-error';
import { type VoiceToolReply } from './ports/voice-agent-provider';
import { replyRefused } from './voice-call-context';

/** Lo que el bot le dice a quien llama cuando las reglas de reserva de la app rechazan algo. */
const MESSAGES_BY_ERROR_CODE: Readonly<Record<string, { reason: string; message: string }>> = {
  SLOT_UNAVAILABLE: {
    reason: 'slot_unavailable',
    message: 'Esa hora ya no está libre. Ofrece otra de las disponibles.',
  },
  OUTSIDE_BOOKING_WINDOW: {
    reason: 'outside_booking_window',
    message:
      'Esa fecha no se puede reservar: o es demasiado pronto o demasiado lejos. Propón otra.',
  },
  ALREADY_BOOKED: {
    reason: 'already_booked',
    message: 'Ya tiene otra cita a esa hora.',
  },
  ROOM_UNAVAILABLE: {
    reason: 'slot_unavailable',
    message: 'No hay sala libre a esa hora. Ofrece otra.',
  },
  SESSION_MODE_NOT_ALLOWED: {
    reason: 'mode_not_allowed',
    message: 'Ese servicio no se da de esa manera. Ofrece las clases que hay.',
  },
  SERVICE_ONLY_IN_SCHEDULE: {
    reason: 'session_required',
    message: 'Ese servicio solo se da en sus clases. Ofrece una de las clases disponibles.',
  },
  PASS_FULLY_BOOKED: {
    reason: 'pass_fully_booked',
    message: 'Ya tiene agendadas todas las clases que le quedan en su bono.',
  },
  PASS_NEEDED_TO_BOOK: {
    reason: 'pass_required',
    message: 'Para reservar necesita un bono en vigor. Dile que lo consulte con el centro.',
  },
  CLIENT_HAS_NO_PASS: {
    reason: 'pass_required',
    message: 'Para reservar necesita un bono en vigor. Dile que lo consulte con el centro.',
  },
  SESSION_FULL: {
    reason: 'session_full',
    message: 'Esa clase está llena. Si el centro tiene lista de espera, ofrécesela.',
  },
  BOOKING_NOT_CANCELLABLE: {
    reason: 'not_cancellable',
    message: 'Esa cita ya no se puede cancelar por teléfono. Pasa la llamada a una persona.',
  },
  BOOKING_NOT_RESCHEDULABLE: {
    reason: 'not_reschedulable',
    message: 'Esa cita no se puede cambiar por teléfono. Pasa la llamada a una persona.',
  },
  RESCHEDULE_TOO_LATE: {
    reason: 'too_late',
    message: 'Ya no hay tiempo para cambiar esa cita. Pasa la llamada a una persona.',
  },
  WAITLIST_SESSION_HAS_SEATS: {
    reason: 'session_has_seats',
    message: 'A esa clase todavía le quedan plazas: se reserva directamente, sin lista de espera.',
  },
  WAITLIST_ALREADY_JOINED: {
    reason: 'already_waiting',
    message: 'Ya está en la lista de espera de esa clase.',
  },
  NOT_FOUND: {
    reason: 'not_found',
    message: 'No se ha encontrado lo que pide. Comprueba los datos con quien llama.',
  },
};

/**
 * Convierte un rechazo de negocio de los casos de uso de siempre en una respuesta para el bot. Un error que no
 * es de negocio (un fallo del servidor) no se esconde: se vuelve a lanzar.
 */
export function toVoiceRefusal(error: unknown): VoiceToolReply {
  if (error instanceof DomainError) {
    const known = MESSAGES_BY_ERROR_CODE[error.code];
    if (known !== undefined) return replyRefused(known.reason, known.message);
  }
  throw error;
}
