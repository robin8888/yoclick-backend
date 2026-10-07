import { calculatePrivacyRequestDueDate, isPrivacyRequestOverdue } from './privacy-request-rules';

describe('calculatePrivacyRequestDueDate', () => {
  it.each([
    ['a normal day', '2026-09-25T10:30:00.000Z', '2026-10-25T10:30:00.000Z'],
    ['the first of the month', '2026-03-01T00:00:00.000Z', '2026-04-01T00:00:00.000Z'],
    [
      'the 31st when the next month is shorter',
      '2026-01-31T09:00:00.000Z',
      '2026-02-28T09:00:00.000Z',
    ],
    ['the 31st in a leap year', '2028-01-31T09:00:00.000Z', '2028-02-29T09:00:00.000Z'],
    [
      'the 30th of a month before a 30-day month',
      '2026-03-31T09:00:00.000Z',
      '2026-04-30T09:00:00.000Z',
    ],
    ['December into January', '2026-12-15T12:00:00.000Z', '2027-01-15T12:00:00.000Z'],
    ['the 31st of December', '2026-12-31T12:00:00.000Z', '2027-01-31T12:00:00.000Z'],
  ])('gives one month after %s', (_caseName, receivedAt, expected) => {
    expect(calculatePrivacyRequestDueDate(new Date(receivedAt)).toISOString()).toBe(expected);
  });

  it('does not change the date it receives', () => {
    const receivedAt = new Date('2026-09-25T10:30:00.000Z');

    calculatePrivacyRequestDueDate(receivedAt);

    expect(receivedAt.toISOString()).toBe('2026-09-25T10:30:00.000Z');
  });
});

describe('isPrivacyRequestOverdue', () => {
  const now = new Date('2026-10-26T00:00:00.000Z');

  it.each([
    ['open and past its date', 'open', '2026-10-25T00:00:00.000Z', true],
    ['open and still in time', 'open', '2026-10-27T00:00:00.000Z', false],
    ['completed after its date', 'completed', '2026-10-25T00:00:00.000Z', false],
    ['rejected after its date', 'rejected', '2026-10-25T00:00:00.000Z', false],
  ])('says %s', (_caseName, status, dueAt, isOverdue) => {
    expect(isPrivacyRequestOverdue({ status, dueAt: new Date(dueAt) }, now)).toBe(isOverdue);
  });
});
