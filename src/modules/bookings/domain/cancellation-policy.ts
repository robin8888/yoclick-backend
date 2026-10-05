import { MILLISECONDS_PER_MINUTE, MINUTES_PER_HOUR } from '../../../shared/time/time-units';

/** Sin política en el centro, se puede cancelar gratis hasta un día antes. */
export const DEFAULT_FREE_CANCELLATION_HOURS = 24;

export type BookingStatusName = 'confirmed' | 'cancelled' | 'attended' | 'no_show';

export interface CancellationNoticeSources {
  /** Antelación propia del servicio, si la define; manda sobre la del centro. */
  readonly serviceCancelNoticeMinutes: number | null;
  /** `freeCancellationHours` de la política del centro; `null` si el centro no tiene política. */
  readonly centerFreeCancellationHours: number | null;
}

export function resolveCancellationNoticeMinutes(sources: CancellationNoticeSources): number {
  if (sources.serviceCancelNoticeMinutes !== null) return sources.serviceCancelNoticeMinutes;
  return (
    (sources.centerFreeCancellationHours ?? DEFAULT_FREE_CANCELLATION_HOURS) * MINUTES_PER_HOUR
  );
}

/** Cancelar "dentro de plazo" es hacerlo con al menos la antelación exigida (el límite exacto cuenta). */
export function isCancellationWithinPolicy(input: {
  readonly startsAt: Date;
  readonly now: Date;
  readonly noticeMinutes: number;
}): boolean {
  const remainingMinutes =
    (input.startsAt.getTime() - input.now.getTime()) / MILLISECONDS_PER_MINUTE;
  return remainingMinutes >= input.noticeMinutes;
}

export type CancellationVerdict = 'can_cancel' | 'already_cancelled' | 'not_cancellable';

/**
 * Se puede cancelar una reserva confirmada que aún no ha empezado. Una ya cancelada se trata como
 * éxito (repetir la petición no falla); una pasada o ya atendida no se puede tocar.
 */
export function decideCancellation(input: {
  readonly status: BookingStatusName;
  readonly startsAt: Date;
  readonly now: Date;
}): CancellationVerdict {
  if (input.status === 'cancelled') return 'already_cancelled';
  if (input.status !== 'confirmed') return 'not_cancellable';
  return input.startsAt > input.now ? 'can_cancel' : 'not_cancellable';
}
