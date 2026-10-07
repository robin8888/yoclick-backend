import {
  buildCenterReport,
  calculateRetentionPercent,
  estimateIncomeCents,
  listMonthsEndingAt,
  resolvePeriodRanges,
  type ReportBooking,
  type ReportFacts,
  type ReportSession,
} from './center-report';

const NOW = new Date('2026-10-07T10:00:00Z');
const TIME_ZONE = 'Europe/Madrid';
const MILLISECONDS_PER_DAY = 86_400_000;
const daysAgo = (dayCount: number, hour = 9): Date => {
  const instant = new Date(NOW.getTime() - dayCount * MILLISECONDS_PER_DAY);
  instant.setUTCHours(hour, 0, 0, 0);
  return instant;
};

function buildSession(
  overrides: Partial<ReportSession> & { bookings?: ReportBooking[] },
): ReportSession {
  const startsAt = overrides.startsAt ?? daysAgo(1);
  return {
    serviceId: 'service-1',
    staffMembershipId: 'staff-1',
    startsAt,
    endsAt: new Date(startsAt.getTime() + 60 * 60_000),
    bookings: [{ status: 'attended', clientMembershipId: 'client-1' }],
    ...overrides,
  };
}

const EVERY_DAY_OPEN = Object.fromEntries(
  ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((day) => [
    day,
    [{ opensAt: '09:00', closesAt: '17:00' }],
  ]),
);

function buildFacts(overrides: Partial<ReportFacts>): ReportFacts {
  return {
    now: NOW,
    timeZone: TIME_ZONE,
    openingHours: EVERY_DAY_OPEN,
    holidayDates: [],
    bookableStaffCount: 1,
    services: [{ id: 'service-1', name: 'Yoga', priceCents: 3000, staffCount: 1 }],
    staff: [{ membershipId: 'staff-1', fullName: 'Marta' }],
    clients: [],
    sessions: [],
    ...overrides,
  };
}

describe('resolvePeriodRanges', () => {
  it.each([
    ['week', '2026-10-01', '2026-10-07', '2026-09-24', '2026-09-30'],
    ['month', '2026-09-08', '2026-10-07', '2026-08-09', '2026-09-07'],
    ['quarter', '2026-07-10', '2026-10-07', '2026-04-11', '2026-07-09'],
  ] as const)(
    '%s ends today and compares with the days before',
    (period, from, to, prevFrom, prevTo) => {
      expect(resolvePeriodRanges(period, NOW, TIME_ZONE)).toEqual({
        current: { fromDate: from, toDate: to },
        previous: { fromDate: prevFrom, toDate: prevTo },
      });
    },
  );
});

describe('listMonthsEndingAt', () => {
  it('lists the months oldest first, crossing the year', () => {
    expect(listMonthsEndingAt('2026-02-10', 4)).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
    ]);
  });
});

describe('estimateIncomeCents', () => {
  const prices = new Map([['service-1', 3000]]);

  it.each([
    ['an attended booking', daysAgo(1), 'attended', 3000],
    ['a confirmed booking of a class that already ended', daysAgo(1), 'confirmed', 3000],
    [
      'a confirmed booking of a class still to come',
      new Date(NOW.getTime() + 86_400_000),
      'confirmed',
      0,
    ],
    ['a no show', daysAgo(1), 'no_show', 0],
  ] as const)('counts %s as %i cents', (_name, startsAt, status, expectedCents) => {
    const session = buildSession({ startsAt, bookings: [{ status, clientMembershipId: 'c' }] });

    expect(estimateIncomeCents([session], prices, NOW)).toBe(expectedCents);
  });

  it('counts a service without price as zero', () => {
    expect(estimateIncomeCents([buildSession({})], new Map([['service-1', null]]), NOW)).toBe(0);
  });
});

describe('calculateRetentionPercent', () => {
  const clients = [
    { membershipId: 'old-and-back', joinedAt: daysAgo(120) },
    { membershipId: 'old-and-gone', joinedAt: daysAgo(120) },
    { membershipId: 'too-new', joinedAt: daysAgo(10) },
  ];
  const sessions = [
    buildSession({
      startsAt: daysAgo(5),
      bookings: [
        { status: 'attended', clientMembershipId: 'old-and-back' },
        { status: 'attended', clientMembershipId: 'too-new' },
      ],
    }),
    buildSession({
      startsAt: daysAgo(115),
      bookings: [{ status: 'attended', clientMembershipId: 'old-and-gone' }],
    }),
  ];

  it('only counts people who have been in the center long enough', () => {
    expect(calculateRetentionPercent(clients, sessions, { afterDays: 90, now: NOW })).toBe(50);
  });

  it('is null when nobody has been there long enough', () => {
    expect(
      calculateRetentionPercent(clients.slice(2), sessions, { afterDays: 90, now: NOW }),
    ).toBeNull();
  });
});

describe('buildCenterReport', () => {
  it('summarizes income, occupancy, services and staff of the period', () => {
    const facts = buildFacts({
      sessions: [buildSession({ startsAt: daysAgo(2) }), buildSession({ startsAt: daysAgo(40) })],
    });

    const report = buildCenterReport(facts, 'month');

    expect(report.estimatedIncomeCents).toBe(3000);
    expect(report.previousEstimatedIncomeCents).toBe(3000);
    // 60 min reservados de 30 días × 480 min abiertos × 1 profesional.
    expect(report.averageOccupancyPercent).toBe(0);
    expect(report.services).toEqual([
      { serviceId: 'service-1', name: 'Yoga', sessionCount: 1, occupancyPercent: 0 },
    ]);
    expect(report.staff).toEqual([
      {
        membershipId: 'staff-1',
        fullName: 'Marta',
        sessionCount: 1,
        hours: 1,
        occupancyPercent: 0,
      },
    ]);
    expect(report.incomeByMonth).toHaveLength(6);
  });

  it('has no occupancy when the center never opens', () => {
    const report = buildCenterReport(buildFacts({ openingHours: null }), 'week');

    expect(report.averageOccupancyPercent).toBeNull();
  });

  it('counts active and inactive clients', () => {
    const facts = buildFacts({
      clients: [
        { membershipId: 'client-1', joinedAt: daysAgo(100) },
        { membershipId: 'client-2', joinedAt: daysAgo(100) },
        { membershipId: 'client-3', joinedAt: daysAgo(2) },
      ],
      sessions: [buildSession({ startsAt: daysAgo(3) })],
    });

    const report = buildCenterReport(facts, 'month');

    expect(report).toMatchObject({ activeClientCount: 1, inactiveClientCount: 1 });
  });

  it('groups the people who joined by month', () => {
    const facts = buildFacts({
      clients: [
        { membershipId: 'client-1', joinedAt: daysAgo(1) },
        { membershipId: 'client-2', joinedAt: daysAgo(2) },
      ],
    });

    const lastCohort = buildCenterReport(facts, 'month').retentionByJoinMonth.at(-1);

    expect(lastCohort).toEqual({
      month: '2026-10',
      joinedCount: 2,
      retainedAfterOneMonthPercent: null,
      retainedAfterThreeMonthsPercent: null,
    });
  });
});
