import { MILLISECONDS_PER_DAY } from '../../../shared/time/time-units';

export const NEW_CLIENT_DAYS = 7;
export const INACTIVE_AFTER_DAYS = 30;

/** Cómo va un cliente: acaba de llegar, usa el centro o lleva un mes sin citas. */
export type ClientActivity = 'new' | 'active' | 'inactive';

export interface ClientActivityFacts {
  readonly joinedAt: Date;
  /** La cita más reciente o próxima que no se canceló; `null` si nunca ha reservado. */
  readonly lastBookingAt: Date | null;
  readonly now: Date;
}

function isWithinDays(instant: Date, dayCount: number, now: Date): boolean {
  return now.getTime() - instant.getTime() < dayCount * MILLISECONDS_PER_DAY;
}

/**
 * «Nuevo» durante la primera semana, aunque aún no haya reservado. Después, «activo» si tiene una cita
 * en los últimos 30 días (o una futura) e «inactivo» si no.
 */
export function resolveClientActivity(facts: ClientActivityFacts): ClientActivity {
  if (isWithinDays(facts.joinedAt, NEW_CLIENT_DAYS, facts.now)) return 'new';
  const hasRecentBooking =
    facts.lastBookingAt !== null &&
    isWithinDays(facts.lastBookingAt, INACTIVE_AFTER_DAYS, facts.now);
  return hasRecentBooking ? 'active' : 'inactive';
}
