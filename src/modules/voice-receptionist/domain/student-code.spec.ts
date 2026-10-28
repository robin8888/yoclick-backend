import { buildStudentCode, normalizeSpokenStudentCode } from './student-code';

describe('buildStudentCode', () => {
  it.each([
    { randomInteger: 0, expected: '000000' },
    { randomInteger: 42, expected: '000042' },
    { randomInteger: 123456, expected: '123456' },
    { randomInteger: 999999, expected: '999999' },
  ])('builds $expected from $randomInteger', ({ randomInteger, expected }) => {
    expect(buildStudentCode(randomInteger)).toBe(expected);
  });
});

describe('normalizeSpokenStudentCode', () => {
  it.each([
    { spoken: '123456', expected: '123456' },
    { spoken: '123 456', expected: '123456' },
    { spoken: '1-2-3-4-5-6', expected: '123456' },
    { spoken: 'es el 123456.', expected: '123456' },
    { spoken: '12345', expected: null },
    { spoken: '1234567', expected: null },
    { spoken: 'no me acuerdo', expected: null },
  ])('reads "$spoken" as $expected', ({ spoken, expected }) => {
    expect(normalizeSpokenStudentCode(spoken)).toBe(expected);
  });
});
