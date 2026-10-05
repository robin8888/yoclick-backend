import {
  calculateActualDurationSeconds,
  decideSessionEnd,
  decideSessionStart,
  isSessionOpen,
  isSessionRecordsRangeAllowed,
  summarizeSessionRecordsByStaff,
  type SessionRecordForTotals,
  type SessionStartFacts,
} from './session-record';

const STARTS_AT = new Date('2026-10-05T10:00:00Z');
const ENDS_AT = new Date('2026-10-05T11:00:00Z');

function startFacts(
  overrides: Partial<SessionStartFacts> & { nowIso?: string },
): SessionStartFacts {
  const { nowIso = '2026-10-05T10:00:00Z', ...rest } = overrides;
  return {
    status: 'confirmed',
    startsAt: STARTS_AT,
    endsAt: ENDS_AT,
    startedAt: null,
    now: new Date(nowIso),
    ...rest,
  };
}

describe('decideSessionStart', () => {
  it.each([
    ['16 minutes before the start', '2026-10-05T09:44:00Z', 'not_startable'],
    ['exactly 15 minutes before the start', '2026-10-05T09:45:00Z', 'can_start'],
    ['at the start', '2026-10-05T10:00:00Z', 'can_start'],
    ['when the class is already running late', '2026-10-05T10:50:00Z', 'can_start'],
    ['exactly at the end', '2026-10-05T11:00:00Z', 'can_start'],
    ['one second after the end', '2026-10-05T11:00:01Z', 'not_startable'],
  ])('answers %s with %s', (_description, nowIso, expected) => {
    expect(decideSessionStart(startFacts({ nowIso }))).toBe(expected);
  });

  it.each(['cancelled', 'attended', 'no_show'] as const)(
    'refuses a %s booking that was never started',
    (status) => {
      expect(decideSessionStart(startFacts({ status }))).toBe('not_startable');
    },
  );

  it('treats an already started class as a success, even outside the window', () => {
    const verdict = decideSessionStart(
      startFacts({ startedAt: new Date('2026-10-05T10:02:00Z'), nowIso: '2026-10-06T10:00:00Z' }),
    );

    expect(verdict).toBe('already_started');
  });
});

describe('decideSessionEnd', () => {
  const startedAt = new Date('2026-10-05T10:02:00Z');
  const endedAt = new Date('2026-10-05T10:58:00Z');

  it.each([
    ['never started', { startedAt: null, endedAt: null }, 'not_started'],
    ['running', { startedAt, endedAt: null }, 'can_end'],
    ['already finished', { startedAt, endedAt }, 'already_ended'],
  ] as const)('answers a class that is %s with %s', (_description, timing, expected) => {
    expect(decideSessionEnd(timing)).toBe(expected);
  });
});

describe('calculateActualDurationSeconds', () => {
  it.each([
    ['not started', null, null, null],
    ['not finished', '2026-10-05T10:00:00Z', null, null],
    ['an exact hour', '2026-10-05T10:00:00Z', '2026-10-05T11:00:00Z', 3600],
    ['dropping the partial second', '2026-10-05T10:00:00.000Z', '2026-10-05T10:00:59.999Z', 59],
    ['closed in the same instant', '2026-10-05T10:00:00Z', '2026-10-05T10:00:00Z', 0],
  ])('returns the seconds for a class %s', (_description, startedIso, endedIso, expected) => {
    const timing = {
      startedAt: startedIso ? new Date(startedIso) : null,
      endedAt: endedIso ? new Date(endedIso) : null,
    };

    expect(calculateActualDurationSeconds(timing)).toBe(expected);
  });
});

describe('isSessionOpen', () => {
  it('is open only when it started and has not ended', () => {
    const moment = new Date();

    expect(isSessionOpen({ startedAt: null, endedAt: null })).toBe(false);
    expect(isSessionOpen({ startedAt: moment, endedAt: null })).toBe(true);
    expect(isSessionOpen({ startedAt: moment, endedAt: moment })).toBe(false);
  });
});

describe('summarizeSessionRecordsByStaff', () => {
  const ana = { membershipId: 'staff-ana', fullName: 'Ana' };
  const bruno = { membershipId: 'staff-bruno', fullName: 'Bruno' };

  function record(overrides: Partial<SessionRecordForTotals>): SessionRecordForTotals {
    return {
      staff: ana,
      plannedDurationSeconds: 3600,
      actualDurationSeconds: 3500,
      isOpen: false,
      ...overrides,
    };
  }

  it('adds up closed classes per person, counts open ones apart and sorts by name', () => {
    const totals = summarizeSessionRecordsByStaff([
      record({ staff: bruno, actualDurationSeconds: 1800, plannedDurationSeconds: 1800 }),
      record({}),
      record({ actualDurationSeconds: 3700 }),
      record({ actualDurationSeconds: null, isOpen: true }),
      record({ actualDurationSeconds: null, isOpen: false }),
    ]);

    expect(totals).toEqual([
      {
        staffMembershipId: 'staff-ana',
        staffName: 'Ana',
        classCount: 2,
        plannedSeconds: 7200,
        actualSeconds: 7200,
        openCount: 1,
      },
      {
        staffMembershipId: 'staff-bruno',
        staffName: 'Bruno',
        classCount: 1,
        plannedSeconds: 1800,
        actualSeconds: 1800,
        openCount: 0,
      },
    ]);
  });

  it('returns nothing when there are no records', () => {
    expect(summarizeSessionRecordsByStaff([])).toEqual([]);
  });
});

describe('isSessionRecordsRangeAllowed', () => {
  it.each([
    ['2026-10-01', '2026-10-01', true],
    ['2026-10-01', '2026-10-31', true],
    ['2026-10-01', '2026-11-01', false],
    ['2026-10-05', '2026-10-04', false],
  ])('answers %s to %s with %s', (fromDate, toDate, expected) => {
    expect(isSessionRecordsRangeAllowed(fromDate, toDate)).toBe(expected);
  });
});
