import { describeCenterChanges, isValidTrialEnd } from './center-changes';

const CURRENT = {
  status: 'trial',
  planId: 'pro',
  trialEndsAt: new Date('2026-11-01T00:00:00Z'),
  maxClients: 150,
} as const;

describe('describeCenterChanges', () => {
  it('leaves a trace for every field that really changes', () => {
    const entries = describeCenterChanges(CURRENT, {
      status: 'suspended',
      trialEndsAt: new Date('2026-11-15T00:00:00Z'),
      maxClients: null,
    });

    expect(entries).toEqual([
      { action: 'center_status_changed', details: { from: 'trial', to: 'suspended' } },
      {
        action: 'trial_changed',
        details: { from: '2026-11-01T00:00:00.000Z', to: '2026-11-15T00:00:00.000Z' },
      },
      { action: 'max_clients_changed', details: { from: 150, to: null } },
    ]);
  });

  it('records a plan change', () => {
    expect(describeCenterChanges(CURRENT, { planId: 'premium' })).toEqual([
      { action: 'center_plan_changed', details: { from: 'pro', to: 'premium' } },
    ]);
    expect(describeCenterChanges(CURRENT, { planId: 'pro' })).toEqual([]);
  });

  it('records nothing when the values are the same as now', () => {
    expect(
      describeCenterChanges(CURRENT, {
        status: 'trial',
        trialEndsAt: new Date('2026-11-01T00:00:00Z'),
        maxClients: 150,
      }),
    ).toEqual([]);
  });

  it('ignores the fields that were not sent', () => {
    expect(describeCenterChanges(CURRENT, {})).toEqual([]);
  });

  it('can remove the trial end', () => {
    expect(describeCenterChanges(CURRENT, { trialEndsAt: null })).toEqual([
      { action: 'trial_changed', details: { from: '2026-11-01T00:00:00.000Z', to: null } },
    ]);
  });
});

describe('isValidTrialEnd', () => {
  const now = new Date('2026-10-21T10:00:00Z');

  it.each([
    { trialEndsAt: new Date('2026-10-22T00:00:00Z'), isValid: true },
    { trialEndsAt: new Date('2026-10-21T10:00:00Z'), isValid: false },
    { trialEndsAt: new Date('2026-10-01T00:00:00Z'), isValid: false },
    { trialEndsAt: null, isValid: true },
  ])('$trialEndsAt -> $isValid', ({ trialEndsAt, isValid }) => {
    expect(isValidTrialEnd(trialEndsAt, now)).toBe(isValid);
  });
});
