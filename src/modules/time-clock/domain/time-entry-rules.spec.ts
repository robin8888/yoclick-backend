import {
  computeWorkedMinutes,
  decideClockAction,
  deriveWorkDate,
  doTimeRangesOverlap,
  findTimeEntryViolation,
  getMonthDateRange,
  summarizeMonth,
} from './time-entry-rules';

const NOW = new Date('2026-10-14T10:00:00Z');

function minutesBefore(instant: Date, minutes: number): Date {
  return new Date(instant.getTime() - minutes * 60_000);
}

describe('decideClockAction', () => {
  const closedShift = (minutesAgo: number) => ({
    id: 'entry-closed',
    clockInAt: minutesBefore(NOW, minutesAgo + 480),
    clockOutAt: minutesBefore(NOW, minutesAgo),
  });
  const openShift = (minutesAgo: number) => ({
    id: 'entry-open',
    clockInAt: minutesBefore(NOW, minutesAgo),
    clockOutAt: null,
  });

  it.each([
    ['clocks in when the person has no shifts', null, { kind: 'clock_in' }],
    ['clocks in after a closed shift', closedShift(120), { kind: 'clock_in' }],
    ['clocks out an open shift', openShift(240), { kind: 'clock_out', entryId: 'entry-open' }],
    [
      'repeats the clock-in when scanned again within 30 seconds',
      { ...openShift(0), clockInAt: new Date(NOW.getTime() - 10_000) },
      { kind: 'repeat', entryId: 'entry-open', action: 'clock_in' },
    ],
    [
      'repeats the clock-out when scanned again within 30 seconds',
      { ...closedShift(0), clockOutAt: new Date(NOW.getTime() - 29_000) },
      { kind: 'repeat', entryId: 'entry-closed', action: 'clock_out' },
    ],
    [
      'clocks out exactly 30 seconds after the clock-in',
      { ...openShift(0), clockInAt: new Date(NOW.getTime() - 30_000) },
      { kind: 'clock_out', entryId: 'entry-open' },
    ],
    [
      'clocks out a shift open for just under 16 hours',
      openShift(16 * 60 - 1),
      { kind: 'clock_out', entryId: 'entry-open' },
    ],
    [
      'abandons a shift open for 16 hours or more and clocks in',
      openShift(16 * 60),
      { kind: 'clock_in_after_abandoned', abandonedEntryId: 'entry-open' },
    ],
  ] as const)('%s', (_name, lastShift, expected) => {
    expect(decideClockAction({ lastShift, now: NOW })).toEqual(expected);
  });
});

describe('findTimeEntryViolation', () => {
  const at = (iso: string): Date => new Date(iso);

  it.each([
    ['accepts a normal shift', '2026-10-13T08:00:00Z', '2026-10-13T16:00:00Z', null],
    ['accepts exactly 16 hours', '2026-10-13T00:00:00Z', '2026-10-13T16:00:00Z', null],
    ['rejects more than 16 hours', '2026-10-13T00:00:00Z', '2026-10-13T16:01:00Z', 'too_long'],
    ['rejects out equal to in', '2026-10-13T08:00:00Z', '2026-10-13T08:00:00Z', 'out_not_after_in'],
    ['rejects out before in', '2026-10-13T08:00:00Z', '2026-10-13T07:00:00Z', 'out_not_after_in'],
    ['rejects an exit in the future', '2026-10-14T08:00:00Z', '2026-10-14T10:00:01Z', 'in_future'],
    ['rejects an entry in the future', '2026-10-14T10:00:01Z', '2026-10-14T12:00:00Z', 'in_future'],
  ] as const)('%s', (_name, clockIn, clockOut, expected) => {
    expect(
      findTimeEntryViolation({ clockInAt: at(clockIn), clockOutAt: at(clockOut), now: NOW }),
    ).toBe(expected);
  });

  it('accepts an open shift started in the past', () => {
    expect(
      findTimeEntryViolation({ clockInAt: at('2026-10-14T08:00:00Z'), clockOutAt: null, now: NOW }),
    ).toBeNull();
  });
});

describe('doTimeRangesOverlap', () => {
  const range = (from: string, to: string | null) => ({
    clockInAt: new Date(`2026-10-13T${from}:00Z`),
    clockOutAt: to === null ? null : new Date(`2026-10-13T${to}:00Z`),
  });

  it.each([
    ['partially overlapping', range('08:00', '12:00'), range('11:00', '15:00'), true],
    ['one inside the other', range('08:00', '18:00'), range('10:00', '11:00'), true],
    ['touching at the edge', range('08:00', '12:00'), range('12:00', '15:00'), false],
    ['disjoint', range('08:00', '10:00'), range('14:00', '15:00'), false],
    ['inside an open shift', range('08:00', null), range('10:00', '11:00'), true],
    ['before an open shift', range('08:00', null), range('06:00', '08:00'), false],
  ] as const)('%s', (_name, first, second, expected) => {
    const reversedPair = [second, first] as const;
    const areReversedOverlapping = doTimeRangesOverlap(reversedPair[0], reversedPair[1]);
    expect(doTimeRangesOverlap(first, second)).toBe(expected);
    expect(areReversedOverlapping).toBe(expected);
  });
});

describe('computeWorkedMinutes', () => {
  it('counts whole minutes and ignores seconds', () => {
    expect(
      computeWorkedMinutes({
        clockInAt: new Date('2026-10-13T08:00:00Z'),
        clockOutAt: new Date('2026-10-13T16:30:59Z'),
      }),
    ).toBe(510);
  });

  it('counts 0 while the shift is open', () => {
    expect(computeWorkedMinutes({ clockInAt: NOW, clockOutAt: null })).toBe(0);
  });
});

describe('deriveWorkDate', () => {
  it.each([
    [
      'uses the local date just after local midnight',
      '2026-10-13T22:30:00Z',
      'Europe/Madrid',
      '2026-10-14',
    ],
    [
      'keeps the day just before local midnight',
      '2026-10-13T21:59:00Z',
      'Europe/Madrid',
      '2026-10-13',
    ],
    [
      'handles the end of summer time (25 Oct 2026)',
      '2026-10-24T22:30:00Z',
      'Europe/Madrid',
      '2026-10-25',
    ],
    [
      'handles the day after the end of summer time',
      '2026-10-25T23:30:00Z',
      'Europe/Madrid',
      '2026-10-26',
    ],
    [
      'handles the start of summer time (29 Mar 2026)',
      '2026-03-28T23:30:00Z',
      'Europe/Madrid',
      '2026-03-29',
    ],
    [
      'counts a night shift on the day it starts',
      '2026-03-29T22:30:00Z',
      'Europe/Madrid',
      '2026-03-30',
    ],
    ['works in a zone behind UTC', '2026-10-14T02:00:00Z', 'America/Mexico_City', '2026-10-13'],
  ] as const)('%s', (_name, instant, timeZone, expected) => {
    expect(deriveWorkDate(new Date(instant), timeZone)).toBe(expected);
  });
});

describe('getMonthDateRange', () => {
  it.each([
    ['2026-10', '2026-10-01', '2026-10-31'],
    ['2026-02', '2026-02-01', '2026-02-28'],
    ['2028-02', '2028-02-01', '2028-02-29'],
    ['2026-12', '2026-12-01', '2026-12-31'],
  ])('covers %s', (month, fromDate, toDate) => {
    expect(getMonthDateRange(month)).toEqual({ fromDate, toDate });
  });
});

describe('summarizeMonth', () => {
  it('adds minutes, counts distinct days and edited entries, and counts open shifts as 0', () => {
    const entry = (workDate: string, from: string, to: string | null, isEdited = false) => ({
      workDate,
      isEdited,
      clockInAt: new Date(`${workDate}T${from}:00Z`),
      clockOutAt: to === null ? null : new Date(`${workDate}T${to}:00Z`),
    });

    const totals = summarizeMonth([
      entry('2026-10-01', '08:00', '12:00'),
      entry('2026-10-01', '14:00', '18:00', true),
      entry('2026-10-02', '08:00', null),
    ]);

    expect(totals).toEqual({ workedMinutes: 480, daysWorked: 2, editedCount: 1 });
  });

  it('returns zeros for an empty month', () => {
    expect(summarizeMonth([])).toEqual({ workedMinutes: 0, daysWorked: 0, editedCount: 0 });
  });
});
