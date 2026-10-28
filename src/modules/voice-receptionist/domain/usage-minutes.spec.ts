import { addMonthsToInstant } from '../../../shared/time/add-months';
import {
  calculateBilledMinutes,
  calculateCallOverageMinutes,
  findCrossedUsageThresholds,
  resolveUsagePeriod,
  resolveUsagePeriodStart,
  shouldBotAnswer,
  summarizeVoiceUsage,
} from './usage-minutes';

describe('calculateBilledMinutes', () => {
  it.each([
    { seconds: 0, minutes: 0 },
    { seconds: -5, minutes: 0 },
    { seconds: 1, minutes: 1 },
    { seconds: 60, minutes: 1 },
    { seconds: 61, minutes: 2 },
    { seconds: 600, minutes: 10 },
  ])('bills $seconds seconds as $minutes minutes', ({ seconds, minutes }) => {
    expect(calculateBilledMinutes(seconds)).toBe(minutes);
  });
});

describe('resolveUsagePeriodStart', () => {
  const now = new Date('2026-10-28T10:00:00.000Z');

  it('uses the subscription period when it is running', () => {
    const periodStart = new Date('2026-10-15T00:00:00.000Z');
    const periodEnd = new Date('2026-11-15T00:00:00.000Z');

    expect(resolveUsagePeriodStart(now, { periodStart, periodEnd })).toEqual(periodStart);
  });

  it.each([
    { name: 'there is no subscription', period: null },
    {
      name: 'the subscription period already ended',
      period: {
        periodStart: new Date('2026-08-01T00:00:00.000Z'),
        periodEnd: new Date('2026-09-01T00:00:00.000Z'),
      },
    },
  ])('falls back to the calendar month when $name', ({ period }) => {
    expect(resolveUsagePeriodStart(now, period)).toEqual(new Date('2026-10-01T00:00:00.000Z'));
  });
});

describe('summarizeVoiceUsage', () => {
  it.each([
    {
      name: 'half used',
      input: { includedMinutes: 150, usedMinutes: 75 },
      expected: { remainingMinutes: 75, overageMinutes: 0, usedPercent: 50 },
    },
    {
      name: 'eighty percent',
      input: { includedMinutes: 250, usedMinutes: 200 },
      expected: { remainingMinutes: 50, overageMinutes: 0, usedPercent: 80 },
    },
    {
      name: 'over the included minutes',
      input: { includedMinutes: 150, usedMinutes: 180 },
      expected: { remainingMinutes: 0, overageMinutes: 30, usedPercent: 100 },
    },
    {
      name: 'no included minutes',
      input: { includedMinutes: 0, usedMinutes: 3 },
      expected: { remainingMinutes: 0, overageMinutes: 3, usedPercent: 100 },
    },
  ])('summarises $name', ({ input, expected }) => {
    expect(summarizeVoiceUsage(input)).toMatchObject(expected);
  });
});

describe('addMonthsToInstant', () => {
  it.each([
    { from: '2026-01-15T10:00:00.000Z', months: 1, to: '2026-02-15T10:00:00.000Z' },
    { from: '2026-01-31T10:00:00.000Z', months: 1, to: '2026-02-28T10:00:00.000Z' },
    { from: '2028-01-31T10:00:00.000Z', months: 1, to: '2028-02-29T10:00:00.000Z' },
    { from: '2026-01-31T10:00:00.000Z', months: 2, to: '2026-03-31T10:00:00.000Z' },
    { from: '2026-03-15T10:00:00.000Z', months: -1, to: '2026-02-15T10:00:00.000Z' },
    { from: '2026-11-30T10:00:00.000Z', months: 3, to: '2027-02-28T10:00:00.000Z' },
  ])('moves $from by $months months to $to', ({ from, months, to }) => {
    expect(addMonthsToInstant(new Date(from), months)).toEqual(new Date(to));
  });
});

describe('resolveUsagePeriod', () => {
  const known = {
    periodStart: new Date('2026-10-15T09:00:00.000Z'),
    periodEnd: new Date('2026-11-15T09:00:00.000Z'),
  };

  it('keeps the billing cycle of the subscription, with the same charge day, after a missed renewal', () => {
    const period = resolveUsagePeriod(new Date('2027-01-20T12:00:00.000Z'), known);

    expect(period.periodStart).toEqual(new Date('2027-01-15T09:00:00.000Z'));
    expect(period.periodEnd).toEqual(new Date('2027-02-15T09:00:00.000Z'));
  });

  it('puts a call that ended just before the period in the previous period', () => {
    const period = resolveUsagePeriod(new Date('2026-10-15T08:59:00.000Z'), known);

    expect(period.periodStart).toEqual(new Date('2026-09-15T09:00:00.000Z'));
  });

  it('uses the calendar month when there is no subscription', () => {
    const period = resolveUsagePeriod(new Date('2026-10-28T10:00:00.000Z'), null);

    expect(period.periodStart).toEqual(new Date('2026-10-01T00:00:00.000Z'));
    expect(period.periodEnd).toEqual(new Date('2026-11-01T00:00:00.000Z'));
  });
});

describe('calculateCallOverageMinutes', () => {
  it.each([
    { name: 'inside the included minutes', included: 150, before: 100, billed: 20, overage: 0 },
    { name: 'exactly reaching them', included: 150, before: 140, billed: 10, overage: 0 },
    { name: 'crossing the limit', included: 150, before: 145, billed: 10, overage: 5 },
    { name: 'already over the limit', included: 150, before: 160, billed: 7, overage: 7 },
    { name: 'with no included minutes', included: 0, before: 0, billed: 3, overage: 3 },
  ])('is $overage for a call $name', ({ included, before, billed, overage }) => {
    expect(
      calculateCallOverageMinutes({
        includedMinutes: included,
        usedBefore: before,
        billedMinutes: billed,
      }),
    ).toBe(overage);
  });

  it('adds up, across calls, to exactly the minutes beyond the included ones', () => {
    const calls = [60, 50, 30, 20];
    let used = 0;
    let overage = 0;
    for (const billed of calls) {
      overage += calculateCallOverageMinutes({
        includedMinutes: 100,
        usedBefore: used,
        billedMinutes: billed,
      });
      used += billed;
    }

    expect(overage).toBe(60);
  });
});

describe('findCrossedUsageThresholds', () => {
  it.each([
    { name: 'nothing crossed', included: 150, before: 10, after: 100, crossed: [] },
    { name: 'the 80 % minute itself', included: 150, before: 119, after: 120, crossed: [80] },
    { name: 'already past 80 %', included: 150, before: 120, after: 140, crossed: [] },
    { name: 'the last included minute', included: 150, before: 149, after: 150, crossed: [100] },
    { name: 'both in one call', included: 150, before: 100, after: 160, crossed: [80, 100] },
    { name: 'already over', included: 150, before: 150, after: 170, crossed: [] },
    {
      name: 'a small allowance, where both thresholds fall on the same minute',
      included: 3,
      before: 2,
      after: 3,
      crossed: [80, 100],
    },
    { name: 'no included minutes', included: 0, before: 0, after: 1, crossed: [80, 100] },
  ])('finds $crossed for $name', ({ included, before, after, crossed }) => {
    expect(
      findCrossedUsageThresholds({
        includedMinutes: included,
        usedBefore: before,
        usedAfter: after,
      }),
    ).toEqual(crossed);
  });
});

describe('shouldBotAnswer', () => {
  it.each([
    { policy: 'continue_and_charge', included: 150, used: 500, expected: true },
    { policy: 'disable_bot', included: 150, used: 149, expected: true },
    { policy: 'disable_bot', included: 150, used: 150, expected: false },
    { policy: 'disable_bot', included: 150, used: 200, expected: false },
    { policy: 'disable_bot', included: 0, used: 0, expected: false },
  ] as const)('is $expected with $policy at $used of $included', (scenario) => {
    expect(
      shouldBotAnswer({
        overagePolicy: scenario.policy,
        includedMinutes: scenario.included,
        usedMinutes: scenario.used,
      }),
    ).toBe(scenario.expected);
  });
});
