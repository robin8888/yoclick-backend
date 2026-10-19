import { MILLISECONDS_PER_HOUR } from '../../../shared/time/time-units';

/** Lo que tiene quien recibe la oferta de una plaza para confirmarla antes de que pase a otra persona. */
export const WAITLIST_OFFER_HOURS = 12;

export function computeOfferExpiry(now: Date): Date {
  return new Date(now.getTime() + WAITLIST_OFFER_HOURS * MILLISECONDS_PER_HOUR);
}

export function isOfferActive(
  entry: { status: string; offerExpiresAt: Date | null },
  now: Date,
): boolean {
  return (
    entry.status === 'offered' &&
    entry.offerExpiresAt !== null &&
    entry.offerExpiresAt.getTime() > now.getTime()
  );
}

/** Plazas que se pueden ofrecer ahora: el aforo menos las reservas y las ofertas aún vigentes. */
export function countOfferableSeats(input: {
  capacity: number;
  bookedCount: number;
  activeOfferCount: number;
}): number {
  return Math.max(input.capacity - input.bookedCount - input.activeOfferCount, 0);
}
