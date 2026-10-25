import { type StoredPassState } from '../../passes/domain/pass-rules';
import { resolveClientPassSummary } from './client-pass-summary';

const NOW = new Date('2026-10-06T10:00:00.000Z');
const daysAgo = (dayCount: number): Date => new Date(NOW.getTime() - dayCount * 86_400_000);
const daysAhead = (dayCount: number): Date => new Date(NOW.getTime() + dayCount * 86_400_000);

function buildPass(overrides: Partial<StoredPassState> = {}): StoredPassState {
  return { status: 'active', remainingSessions: 5, expiresAt: daysAhead(30), ...overrides };
}

describe('resolveClientPassSummary', () => {
  it.each([
    ['no passes', [], 'none'],
    ['only a rejected pass', [buildPass({ status: 'rejected' })], 'none'],
    ['only a cancelled pass', [buildPass({ status: 'cancelled' })], 'none'],
    ['a requested pass', [buildPass({ status: 'pending', expiresAt: null })], 'pending'],
    ['a usable pass', [buildPass()], 'active'],
    ['an exhausted pass', [buildPass({ remainingSessions: 0 })], 'ended'],
    ['an expired pass', [buildPass({ expiresAt: daysAgo(1) })], 'ended'],
    [
      'an expired pass and a requested one',
      [buildPass({ expiresAt: daysAgo(1) }), buildPass({ status: 'pending' })],
      'pending',
    ],
    [
      'an expired pass and a usable one',
      [buildPass({ expiresAt: daysAgo(1) }), buildPass()],
      'active',
    ],
  ] as const)('%s gives %s', (_caseName, passes, expectedState) => {
    expect(resolveClientPassSummary(passes, NOW).state).toBe(expectedState);
  });

  it('adds up the remaining sessions and reports the first expiry of the usable passes', () => {
    const summary = resolveClientPassSummary(
      [
        buildPass({ remainingSessions: 3, expiresAt: daysAhead(10) }),
        buildPass({ remainingSessions: 4, expiresAt: daysAhead(2) }),
        buildPass({ remainingSessions: 9, expiresAt: daysAgo(2) }),
      ],
      NOW,
    );
    expect(summary).toEqual({ state: 'active', remainingSessions: 7, expiresAt: daysAhead(2) });
  });

  it('leaves the numbers empty when nothing is usable', () => {
    expect(resolveClientPassSummary([buildPass({ remainingSessions: 0 })], NOW)).toEqual({
      state: 'ended',
      remainingSessions: null,
      expiresAt: null,
    });
  });
});
