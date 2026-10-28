import { arePhoneNumbersEqual, isE164PhoneNumber, normalizePhoneNumber } from './phone-number';

describe('normalizePhoneNumber', () => {
  it.each([
    { input: '+34600112233', expected: '+34600112233' },
    { input: '600 11 22 33', expected: '+34600112233' },
    { input: '0034 600-112-233', expected: '+34600112233' },
    { input: '(+34) 910 000 000', expected: '+34910000000' },
    { input: '+44 20 7946 0958', expected: '+442079460958' },
    { input: '12345', expected: null },
    { input: 'abc', expected: null },
    { input: '', expected: null },
  ])('turns "$input" into $expected', ({ input, expected }) => {
    expect(normalizePhoneNumber(input)).toBe(expected);
  });
});

describe('isE164PhoneNumber', () => {
  it('accepts only the plus sign followed by 8 to 15 digits', () => {
    expect(isE164PhoneNumber('+34910000000')).toBe(true);
    expect(isE164PhoneNumber('910000000')).toBe(false);
    expect(isE164PhoneNumber('+3491')).toBe(false);
  });
});

describe('arePhoneNumbersEqual', () => {
  it('compares numbers written in different formats', () => {
    expect(arePhoneNumbersEqual('600 11 22 33', '+34600112233')).toBe(true);
    expect(arePhoneNumbersEqual('600 11 22 33', '+34600112244')).toBe(false);
    expect(arePhoneNumbersEqual('no es un teléfono', 'no es un teléfono')).toBe(false);
  });
});
