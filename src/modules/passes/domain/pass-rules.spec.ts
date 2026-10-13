import {
  computePassExpiry,
  pickPassToConsume,
  resolvePassStatus,
  type ConsumablePass,
} from './pass-rules';

const NOW = new Date('2026-10-10T10:00:00.000Z');
const TOMORROW = new Date('2026-10-11T10:00:00.000Z');
const NEXT_WEEK = new Date('2026-10-17T10:00:00.000Z');
const YESTERDAY = new Date('2026-10-09T10:00:00.000Z');
const KARATE = '11111111-1111-4111-8111-111111111111';
const YOGA = '22222222-2222-4222-8222-222222222222';

function buildPass(overrides: Partial<ConsumablePass> & { id: string }): ConsumablePass {
  return {
    status: 'active',
    remainingSessions: 5,
    expiresAt: NEXT_WEEK,
    serviceIds: [],
    ...overrides,
  };
}

describe('resolvePassStatus', () => {
  it.each([
    ['pending', { status: 'pending', remainingSessions: 5, expiresAt: null }, 'pending'],
    ['rejected', { status: 'rejected', remainingSessions: 5, expiresAt: null }, 'rejected'],
    ['active', { status: 'active', remainingSessions: 5, expiresAt: NEXT_WEEK }, 'active'],
    ['exhausted', { status: 'active', remainingSessions: 0, expiresAt: NEXT_WEEK }, 'exhausted'],
    ['expired', { status: 'active', remainingSessions: 5, expiresAt: YESTERDAY }, 'expired'],
    ['expires right now', { status: 'active', remainingSessions: 5, expiresAt: NOW }, 'expired'],
  ] as const)('%s', (_label, stored, expected) => {
    expect(resolvePassStatus(stored, NOW)).toBe(expected);
  });
});

describe('computePassExpiry', () => {
  it('adds the validity days to the start', () => {
    expect(computePassExpiry(NOW, 30).toISOString()).toBe('2026-11-09T10:00:00.000Z');
  });
});

describe('pickPassToConsume', () => {
  it('takes the one that expires first among the usable', () => {
    const passes = [
      buildPass({ id: 'later', expiresAt: NEXT_WEEK }),
      buildPass({ id: 'sooner', expiresAt: TOMORROW }),
    ];
    expect(pickPassToConsume(passes, { serviceId: KARATE, now: NOW })).toBe('sooner');
  });

  it('skips exhausted, expired, pending and rejected passes', () => {
    const passes = [
      buildPass({ id: 'exhausted', remainingSessions: 0 }),
      buildPass({ id: 'expired', expiresAt: YESTERDAY }),
      buildPass({ id: 'pending', status: 'pending' }),
      buildPass({ id: 'rejected', status: 'rejected' }),
    ];
    expect(pickPassToConsume(passes, { serviceId: KARATE, now: NOW })).toBeNull();
  });

  it('respects the services of the pass, and empty means every service', () => {
    const passes = [
      buildPass({ id: 'yoga-only', serviceIds: [YOGA], expiresAt: TOMORROW }),
      buildPass({ id: 'any', serviceIds: [] }),
    ];
    expect(pickPassToConsume(passes, { serviceId: KARATE, now: NOW })).toBe('any');
    expect(pickPassToConsume(passes, { serviceId: YOGA, now: NOW })).toBe('yoga-only');
  });
});
