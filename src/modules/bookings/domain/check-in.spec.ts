import {
  buildCheckInQrContent,
  extractCheckInToken,
  pickBookingToCheckIn,
  type CheckInCandidate,
} from './check-in';

const NOW = new Date('2026-10-05T10:00:00Z');
const MINUTE = 60_000;

function candidate(startsInMinutes: number, overrides: Partial<CheckInCandidate> = {}) {
  const startsAt = new Date(NOW.getTime() + startsInMinutes * MINUTE);
  return {
    bookingId: `booking-${String(startsInMinutes)}`,
    status: 'confirmed' as const,
    startsAt,
    endsAt: new Date(startsAt.getTime() + 60 * MINUTE),
    ...overrides,
  };
}

describe('pickBookingToCheckIn', () => {
  it.each([
    ['one hour before the start', 60, true],
    ['more than one hour before', 61, false],
    ['in the middle of the class', -30, true],
    ['after the class ended', -61, false],
  ])('%s', (_caseName, startsInMinutes, isPicked) => {
    const picked = pickBookingToCheckIn([candidate(startsInMinutes)], NOW);

    expect(picked !== null).toBe(isPicked);
  });

  it('ignores bookings that are not confirmed', () => {
    expect(
      pickBookingToCheckIn(
        [candidate(10, { status: 'cancelled' }), candidate(10, { status: 'attended' })],
        NOW,
      ),
    ).toBeNull();
  });

  it('prefers the booking that starts first', () => {
    expect(pickBookingToCheckIn([candidate(45), candidate(-20)], NOW)?.bookingId).toBe(
      'booking--20',
    );
  });
});

describe('check-in QR content', () => {
  const TOKEN = 'aaa.bbb.ccc';

  it('round-trips the token', () => {
    expect(extractCheckInToken(buildCheckInQrContent(TOKEN))).toBe(TOKEN);
  });

  it.each([
    'https://yoclick.app/j/NORTE7',
    'yoclick:checkin:',
    'yoclick:checkin:no-es-jwt',
    'yoclick:checkin:a.b.c extra',
    `yoclick:checkin:${'a'.repeat(2001)}.b.c`,
    'YOCLICK:CHECKIN:a.b.c',
  ])('rejects «%s»', (qrContent) => {
    expect(extractCheckInToken(qrContent)).toBeNull();
  });
});
