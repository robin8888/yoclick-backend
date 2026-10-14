import { decidePassAccess, type AccessPass } from './pass-access';

const NOW = new Date('2026-10-14T10:00:00Z');
const FUTURE = new Date('2026-11-01T00:00:00Z');
const PAST = new Date('2026-10-01T00:00:00Z');

function buildPass(overrides: Partial<AccessPass> = {}): AccessPass {
  return {
    name: 'Bono 10',
    status: 'active',
    remainingSessions: 5,
    totalSessions: 10,
    expiresAt: FUTURE,
    ...overrides,
  };
}

describe('decidePassAccess', () => {
  it.each([
    ['active pass with sessions and future expiry', [buildPass()], true, 'valid_pass'],
    ['active pass without expiry', [buildPass({ expiresAt: null })], true, 'valid_pass'],
    ['pass expiring right now is expired', [buildPass({ expiresAt: NOW })], false, 'pass_expired'],
    [
      'pass expiring one millisecond from now is valid',
      [buildPass({ expiresAt: new Date(NOW.getTime() + 1) })],
      true,
      'valid_pass',
    ],
    ['expired pass', [buildPass({ expiresAt: PAST })], false, 'pass_expired'],
    ['exhausted pass', [buildPass({ remainingSessions: 0 })], false, 'pass_exhausted'],
    ['pending pass', [buildPass({ status: 'pending' })], false, 'pass_pending'],
    ['rejected pass is ignored', [buildPass({ status: 'rejected' })], false, 'no_pass'],
    ['cancelled pass is ignored', [buildPass({ status: 'cancelled' })], false, 'no_pass'],
    ['no passes', [], false, 'no_pass'],
  ] as const)('%s', (_name, passes, isGranted, reason) => {
    const decision = decidePassAccess({ passes, hasRates: true, now: NOW });

    expect(decision.isGranted).toBe(isGranted);
    expect(decision.reason).toBe(reason);
  });

  it('does not control access when the center has no rates', () => {
    const decision = decidePassAccess({ passes: [], hasRates: false, now: NOW });

    expect(decision).toEqual({ isGranted: true, reason: 'passes_not_required', pass: null });
  });

  it('picks the valid pass that expires first among several', () => {
    const sooner = buildPass({ name: 'Sooner', expiresAt: new Date('2026-10-20T00:00:00Z') });
    const later = buildPass({ name: 'Later', remainingSessions: 9 });

    const decision = decidePassAccess({ passes: [later, sooner], hasRates: true, now: NOW });

    expect(decision.pass?.name).toBe('Sooner');
  });

  it('prefers the one with more sessions when they expire together', () => {
    const fewer = buildPass({ name: 'Fewer', remainingSessions: 1 });
    const more = buildPass({ name: 'More', remainingSessions: 4 });

    const decision = decidePassAccess({ passes: [fewer, more], hasRates: true, now: NOW });

    expect(decision.pass?.name).toBe('More');
  });

  it('grants access when a valid pass sits next to an expired one', () => {
    const decision = decidePassAccess({
      passes: [buildPass({ expiresAt: PAST }), buildPass({ name: 'Valid' })],
      hasRates: true,
      now: NOW,
    });

    expect(decision).toMatchObject({ isGranted: true, pass: { name: 'Valid' } });
  });

  it('explains the denial with the most informative reason: expired over exhausted over pending', () => {
    const passes = [
      buildPass({ status: 'pending' }),
      buildPass({ remainingSessions: 0 }),
      buildPass({ expiresAt: PAST, name: 'Old' }),
    ];

    const decision = decidePassAccess({ passes, hasRates: true, now: NOW });

    expect(decision).toMatchObject({ reason: 'pass_expired', pass: { name: 'Old' } });
  });
});
