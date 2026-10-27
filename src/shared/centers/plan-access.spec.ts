import { isPlanRequired, type PlanAccessFacts } from './plan-access';

const NOW = new Date('2026-11-10T12:00:00Z');
const PAST = new Date('2026-11-09T12:00:00Z');
const FUTURE = new Date('2026-11-11T12:00:00Z');

const BASE: PlanAccessFacts = {
  status: 'trial',
  trialEndsAt: FUTURE,
  graceEndsAt: null,
  hasSubscription: false,
};

describe('isPlanRequired', () => {
  it.each<[string, Partial<PlanAccessFacts>, boolean]>([
    ['a trial that is still running', {}, false],
    ['a trial that ended without a plan', { trialEndsAt: PAST }, true],
    ['a trial that ended exactly now', { trialEndsAt: NOW }, true],
    [
      'a trial that ended but already has a subscription',
      { trialEndsAt: PAST, hasSubscription: true },
      false,
    ],
    ['a trial without end date', { trialEndsAt: null }, false],
    ['an active center', { status: 'active', trialEndsAt: null, hasSubscription: true }, false],
    ['a center in grace', { status: 'past_due', graceEndsAt: FUTURE }, false],
    ['a center whose grace ran out', { status: 'past_due', graceEndsAt: PAST }, true],
    ['a past due center with no grace date', { status: 'past_due' }, false],
    ['a suspended center', { status: 'suspended' }, true],
  ])('%s', (_name, overrides, expected) => {
    expect(isPlanRequired({ ...BASE, ...overrides }, NOW)).toBe(expected);
  });
});
