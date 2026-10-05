import {
  decideCancellation,
  isCancellationWithinPolicy,
  resolveCancellationNoticeMinutes,
} from './cancellation-policy';

const NOW = new Date('2026-10-05T10:00:00Z');
const HOUR_MS = 3_600_000;

function hoursFromNow(hours: number): Date {
  return new Date(NOW.getTime() + hours * HOUR_MS);
}

describe('resolveCancellationNoticeMinutes', () => {
  it.each([
    { case: 'no policy anywhere: 24 hours', service: null, center: null, expected: 1_440 },
    { case: 'the center policy', service: null, center: 48, expected: 2_880 },
    {
      case: 'a center that cancels for free until the last minute',
      service: null,
      center: 0,
      expected: 0,
    },
    { case: 'the service notice wins over the center', service: 90, center: 48, expected: 90 },
    { case: 'a service that allows cancelling at any time', service: 0, center: 48, expected: 0 },
  ])('uses $case', ({ service, center, expected }) => {
    expect(
      resolveCancellationNoticeMinutes({
        serviceCancelNoticeMinutes: service,
        centerFreeCancellationHours: center,
      }),
    ).toBe(expected);
  });
});

describe('isCancellationWithinPolicy', () => {
  it.each([
    { case: 'far ahead', startsAt: hoursFromNow(72), noticeMinutes: 1_440, expected: true },
    {
      case: 'exactly at the limit',
      startsAt: hoursFromNow(24),
      noticeMinutes: 1_440,
      expected: true,
    },
    {
      case: 'one minute late',
      startsAt: new Date(hoursFromNow(24).getTime() - 60_000),
      noticeMinutes: 1_440,
      expected: false,
    },
    {
      case: 'a few hours before',
      startsAt: hoursFromNow(3),
      noticeMinutes: 1_440,
      expected: false,
    },
    {
      case: 'with no notice required, up to the start',
      startsAt: hoursFromNow(0),
      noticeMinutes: 0,
      expected: true,
    },
  ])('is $expected when cancelling $case', ({ startsAt, noticeMinutes, expected }) => {
    expect(isCancellationWithinPolicy({ startsAt, now: NOW, noticeMinutes })).toBe(expected);
  });
});

describe('decideCancellation', () => {
  it.each([
    {
      case: 'a confirmed future booking',
      status: 'confirmed',
      startsAt: hoursFromNow(5),
      verdict: 'can_cancel',
    },
    {
      case: 'a confirmed booking that already started',
      status: 'confirmed',
      startsAt: hoursFromNow(-1),
      verdict: 'not_cancellable',
    },
    {
      case: 'a booking that starts right now',
      status: 'confirmed',
      startsAt: hoursFromNow(0),
      verdict: 'not_cancellable',
    },
    {
      case: 'a booking that was already cancelled',
      status: 'cancelled',
      startsAt: hoursFromNow(5),
      verdict: 'already_cancelled',
    },
    {
      case: 'a cancelled booking in the past',
      status: 'cancelled',
      startsAt: hoursFromNow(-5),
      verdict: 'already_cancelled',
    },
    {
      case: 'an attended booking',
      status: 'attended',
      startsAt: hoursFromNow(5),
      verdict: 'not_cancellable',
    },
    {
      case: 'a no-show',
      status: 'no_show',
      startsAt: hoursFromNow(-5),
      verdict: 'not_cancellable',
    },
  ] as const)('judges $case as $verdict', ({ status, startsAt, verdict }) => {
    expect(decideCancellation({ status, startsAt, now: NOW })).toBe(verdict);
  });
});
