import { MILLISECONDS_PER_MINUTE } from '../../../shared/time/time-units';
import { type BookingStatusName } from './cancellation-policy';

/** La persona puede llegar y registrarse un rato antes de su hora. */
export const CHECKIN_EARLY_MINUTES = 60;

export interface CheckInCandidate {
  readonly bookingId: string;
  readonly status: BookingStatusName;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

function isInsideCheckInWindow(candidate: CheckInCandidate, now: Date): boolean {
  const opensAt = candidate.startsAt.getTime() - CHECKIN_EARLY_MINUTES * MILLISECONDS_PER_MINUTE;
  return now.getTime() >= opensAt && now <= candidate.endsAt;
}

/**
 * La cita que el QR registra: la confirmada cuya ventana (desde 60 minutos antes hasta que termina)
 * contiene el momento, y de ellas la que antes empieza. `null` si no hay ninguna.
 */
export function pickBookingToCheckIn(
  candidates: readonly CheckInCandidate[],
  now: Date,
): CheckInCandidate | null {
  const eligible = candidates
    .filter(
      (candidate) => candidate.status === 'confirmed' && isInsideCheckInWindow(candidate, now),
    )
    .sort((first, second) => first.startsAt.getTime() - second.startsAt.getTime());
  return eligible[0] ?? null;
}

const QR_PREFIX = 'yoclick:checkin:';
const MAX_QR_CONTENT_LENGTH = 2000;

export function buildCheckInQrContent(token: string): string {
  return `${QR_PREFIX}${token}`;
}

/** El contenido de un QR es entrada no confiable: solo `yoclick:checkin:<jwt>` y nada más (SEC-M4). */
export function extractCheckInToken(qrContent: string): string | null {
  if (qrContent.length > MAX_QR_CONTENT_LENGTH || !qrContent.startsWith(QR_PREFIX)) return null;
  const token = qrContent.slice(QR_PREFIX.length);
  return /^[\w-]+\.[\w-]+\.[\w-]+$/.test(token) ? token : null;
}
