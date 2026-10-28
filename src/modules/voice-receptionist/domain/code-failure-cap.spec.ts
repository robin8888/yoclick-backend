import { isCenterCodeFailureCapReached, resolveFailureWindowStart } from './code-failure-cap';

describe('resolveFailureWindowStart', () => {
  it('is the start of the hour in UTC, the same for every instant inside it', () => {
    const start = new Date('2026-10-28T10:00:00.000Z');

    expect(resolveFailureWindowStart(new Date('2026-10-28T10:00:00.000Z'))).toEqual(start);
    expect(resolveFailureWindowStart(new Date('2026-10-28T10:59:59.999Z'))).toEqual(start);
    expect(resolveFailureWindowStart(new Date('2026-10-28T11:00:00.000Z'))).toEqual(
      new Date('2026-10-28T11:00:00.000Z'),
    );
  });
});

describe('isCenterCodeFailureCapReached', () => {
  it.each([
    { failed: 0, cap: 20, expected: false },
    { failed: 19, cap: 20, expected: false },
    { failed: 20, cap: 20, expected: true },
    { failed: 35, cap: 20, expected: true },
  ])('is $expected with $failed failures and a cap of $cap', ({ failed, cap, expected }) => {
    expect(isCenterCodeFailureCapReached(failed, cap)).toBe(expected);
  });
});
