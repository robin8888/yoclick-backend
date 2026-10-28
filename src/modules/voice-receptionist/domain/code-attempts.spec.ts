import {
  CODE_LOCKOUT_MINUTES,
  countRemainingCodeAttempts,
  isCodeLookupLocked,
  NO_CODE_ATTEMPTS,
  registerFailedCodeAttempt,
} from './code-attempts';

const NOW = new Date('2026-10-28T10:00:00.000Z');
const MINUTE_MS = 60_000;

describe('registerFailedCodeAttempt', () => {
  it('counts the first and second failures without locking', () => {
    const afterFirst = registerFailedCodeAttempt(NO_CODE_ATTEMPTS, NOW);
    const afterSecond = registerFailedCodeAttempt(afterFirst, NOW);

    expect(afterFirst).toEqual({ failedCount: 1, lockedUntil: null });
    expect(afterSecond).toEqual({ failedCount: 2, lockedUntil: null });
  });

  it('locks the number for thirty minutes on the third failure and starts counting again', () => {
    const afterThird = registerFailedCodeAttempt({ failedCount: 2, lockedUntil: null }, NOW);

    expect(afterThird.failedCount).toBe(0);
    expect(afterThird.lockedUntil?.getTime()).toBe(
      NOW.getTime() + CODE_LOCKOUT_MINUTES * MINUTE_MS,
    );
  });

  it('does not extend a lockout that is still running', () => {
    const lockedUntil = new Date(NOW.getTime() + 10 * MINUTE_MS);

    expect(registerFailedCodeAttempt({ failedCount: 0, lockedUntil }, NOW).lockedUntil).toEqual(
      lockedUntil,
    );
  });
});

describe('isCodeLookupLocked', () => {
  it.each([
    { name: 'no lockout', lockedUntil: null, expected: false },
    { name: 'a lockout in the future', lockedUntil: new Date(NOW.getTime() + 1), expected: true },
    {
      name: 'a lockout that already ended',
      lockedUntil: new Date(NOW.getTime() - 1),
      expected: false,
    },
  ])('is $expected with $name', ({ lockedUntil, expected }) => {
    expect(isCodeLookupLocked({ failedCount: 0, lockedUntil }, NOW)).toBe(expected);
  });
});

describe('countRemainingCodeAttempts', () => {
  it('tells how many attempts are left and zero while locked', () => {
    expect(countRemainingCodeAttempts(NO_CODE_ATTEMPTS, NOW)).toBe(3);
    expect(countRemainingCodeAttempts({ failedCount: 2, lockedUntil: null }, NOW)).toBe(1);
    expect(
      countRemainingCodeAttempts({ failedCount: 0, lockedUntil: new Date(NOW.getTime() + 1) }, NOW),
    ).toBe(0);
  });
});
