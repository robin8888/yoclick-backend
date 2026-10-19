import { isBookingBlockedByRefund, type RefundBlockFacts } from './refund-block';

const BOOKED_AT = new Date('2026-10-10T10:00:00Z');
const REFUNDED_AT = new Date('2026-10-12T10:00:00Z');

const BLOCKED_FACTS: RefundBlockFacts = {
  bookingCreatedAt: BOOKED_AT,
  bookingStatus: 'confirmed',
  bookingSource: 'single',
  hasValidPass: false,
  refundedPassCancelledAt: [REFUNDED_AT],
};

describe('isBookingBlockedByRefund', () => {
  it.each([
    ['blocks a booking made before a full refund', {}, true],
    [
      'keeps a booking made after the refund usable',
      { bookingCreatedAt: new Date('2026-10-13T10:00:00Z') },
      false,
    ],
    ['unblocks once the person has a valid pass', { hasValidPass: true }, false],
    ['does not block without any refund', { refundedPassCancelledAt: [] }, false],
    ['does not block a cancelled booking', { bookingStatus: 'cancelled' }, false],
    ['does not block a fixed-group enrollment', { bookingSource: 'enrollment' }, false],
  ] as const)('%s', (_name, overrides, expected) => {
    expect(isBookingBlockedByRefund({ ...BLOCKED_FACTS, ...overrides })).toBe(expected);
  });
});
