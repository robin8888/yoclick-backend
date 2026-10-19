import {
  computeOfferExpiry,
  countOfferableSeats,
  isOfferActive,
  WAITLIST_OFFER_HOURS,
} from './waitlist-rules';

const NOW = new Date('2026-10-20T10:00:00.000Z');
const HOUR_MS = 3_600_000;

describe('computeOfferExpiry', () => {
  it('gives twelve hours to confirm', () => {
    expect(WAITLIST_OFFER_HOURS).toBe(12);
    expect(computeOfferExpiry(NOW).getTime() - NOW.getTime()).toBe(12 * HOUR_MS);
  });
});

describe('isOfferActive', () => {
  it.each([
    ['an offer that has not expired', 'offered', new Date(NOW.getTime() + HOUR_MS), true],
    ['an offer that expires right now', 'offered', NOW, false],
    ['an expired offer', 'offered', new Date(NOW.getTime() - HOUR_MS), false],
    ['someone still waiting', 'waiting', null, false],
    ['an offer already confirmed', 'confirmed', new Date(NOW.getTime() + HOUR_MS), false],
  ] as const)('%s', (_name, status, offerExpiresAt, expected) => {
    expect(isOfferActive({ status, offerExpiresAt }, NOW)).toBe(expected);
  });
});

describe('countOfferableSeats', () => {
  it.each([
    { capacity: 5, bookedCount: 5, activeOfferCount: 0, expected: 0 },
    { capacity: 5, bookedCount: 4, activeOfferCount: 0, expected: 1 },
    { capacity: 5, bookedCount: 4, activeOfferCount: 1, expected: 0 },
    { capacity: 5, bookedCount: 3, activeOfferCount: 1, expected: 1 },
    { capacity: 5, bookedCount: 6, activeOfferCount: 1, expected: 0 },
  ])(
    'capacity $capacity, booked $bookedCount, offered $activeOfferCount',
    ({ expected, ...input }) => {
      expect(countOfferableSeats(input)).toBe(expected);
    },
  );
});
