import { isValidServiceDuration } from './service-rules';

describe('isValidServiceDuration', () => {
  it.each([
    { durationMinutes: 15, expected: true },
    { durationMinutes: 45, expected: true },
    { durationMinutes: 480, expected: true },
    { durationMinutes: 14, expected: false },
    { durationMinutes: 0, expected: false },
    { durationMinutes: 50.5, expected: false },
    { durationMinutes: 47, expected: false },
    { durationMinutes: 485, expected: false },
    { durationMinutes: -15, expected: false },
  ])('is $expected for $durationMinutes minutes', ({ durationMinutes, expected }) => {
    expect(isValidServiceDuration(durationMinutes)).toBe(expected);
  });
});
