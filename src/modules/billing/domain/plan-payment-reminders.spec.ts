import {
  countTrialDaysLeft,
  describeReminderReason,
  selectDueReminderKind,
  type PlanPaymentEmailKind,
} from './plan-payment-reminders';

const NOW = new Date('2026-10-27T10:00:00.000Z');
const HOUR_MS = 3_600_000;

function endsIn(hours: number): Date {
  return new Date(NOW.getTime() + hours * HOUR_MS);
}

describe('countTrialDaysLeft', () => {
  it.each([
    { name: 'exactly seven days', trialEndsAt: endsIn(7 * 24), expected: 7 },
    { name: 'six days and one hour', trialEndsAt: endsIn(6 * 24 + 1), expected: 7 },
    { name: 'two days and a bit', trialEndsAt: endsIn(2 * 24 + 5), expected: 3 },
    { name: 'less than a day', trialEndsAt: endsIn(5), expected: 1 },
  ])('counts $name as $expected day(s) left', ({ trialEndsAt, expected }) => {
    expect(countTrialDaysLeft({ trialEndsAt, now: NOW })).toBe(expected);
  });
});

describe('selectDueReminderKind', () => {
  it.each<{
    name: string;
    trialEndsAt: Date;
    sentKinds: PlanPaymentEmailKind[];
    expected: PlanPaymentEmailKind | null;
  }>([
    {
      name: 'more than seven days left and no welcome email yet',
      trialEndsAt: endsIn(8 * 24),
      sentKinds: [],
      expected: 'trial_started',
    },
    {
      name: 'more than seven days left and the welcome email already sent',
      trialEndsAt: endsIn(13 * 24),
      sentKinds: ['trial_started'],
      expected: null,
    },
    {
      name: 'seven days left and only the welcome email sent',
      trialEndsAt: endsIn(7 * 24),
      sentKinds: ['trial_started'],
      expected: 'trial_ending_7',
    },
    {
      name: 'seven days left',
      trialEndsAt: endsIn(7 * 24),
      sentKinds: [],
      expected: 'trial_ending_7',
    },
    {
      name: 'five days left',
      trialEndsAt: endsIn(5 * 24),
      sentKinds: [],
      expected: 'trial_ending_7',
    },
    {
      name: 'four days left',
      trialEndsAt: endsIn(3 * 24 + 6),
      sentKinds: [],
      expected: 'trial_ending_7',
    },
    {
      name: 'three days left',
      trialEndsAt: endsIn(3 * 24),
      sentKinds: [],
      expected: 'trial_ending_3',
    },
    {
      name: 'two days left',
      trialEndsAt: endsIn(2 * 24),
      sentKinds: [],
      expected: 'trial_ending_3',
    },
    { name: 'one day left', trialEndsAt: endsIn(24), sentKinds: [], expected: 'trial_ending_1' },
    { name: 'a few hours left', trialEndsAt: endsIn(3), sentKinds: [], expected: 'trial_ending_1' },
    { name: 'just ended', trialEndsAt: endsIn(0), sentKinds: [], expected: 'trial_ended' },
    {
      name: 'ended three days ago',
      trialEndsAt: endsIn(-72),
      sentKinds: [],
      expected: 'trial_ended',
    },
    {
      name: 'ended seven days ago',
      trialEndsAt: endsIn(-7 * 24),
      sentKinds: [],
      expected: 'trial_ended',
    },
    { name: 'ended eight days ago', trialEndsAt: endsIn(-8 * 24), sentKinds: [], expected: null },
    {
      name: 'the seven-day reminder was already sent',
      trialEndsAt: endsIn(5 * 24),
      sentKinds: ['trial_ending_7'],
      expected: null,
    },
    {
      name: 'only an earlier reminder was sent',
      trialEndsAt: endsIn(2 * 24),
      sentKinds: ['trial_ending_7'],
      expected: 'trial_ending_3',
    },
    {
      name: 'a late run in the last day skips the old reminders',
      trialEndsAt: endsIn(10),
      sentKinds: [],
      expected: 'trial_ending_1',
    },
    {
      name: 'the ended email was already sent',
      trialEndsAt: endsIn(-24),
      sentKinds: ['trial_ended'],
      expected: null,
    },
  ])('returns $expected when $name', ({ trialEndsAt, sentKinds, expected }) => {
    expect(selectDueReminderKind({ trialEndsAt, now: NOW, sentKinds })).toBe(expected);
  });
});

describe('describeReminderReason', () => {
  it.each([
    { kind: 'trial_started' as const, expected: { type: 'trial_started' } },
    { kind: 'trial_ending_7' as const, expected: { type: 'trial_ending', daysLeft: 7 } },
    { kind: 'trial_ending_3' as const, expected: { type: 'trial_ending', daysLeft: 3 } },
    { kind: 'trial_ending_1' as const, expected: { type: 'trial_ending', daysLeft: 1 } },
    { kind: 'trial_ended' as const, expected: { type: 'trial_ended' } },
  ])('describes $kind', ({ kind, expected }) => {
    expect(describeReminderReason(kind)).toEqual(expected);
  });
});
