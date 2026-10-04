import { generateVerificationCode, VERIFICATION_CODE_LENGTH } from './verification-code';

describe('generateVerificationCode', () => {
  it('is always exactly 6 digits', () => {
    for (let attempt = 0; attempt < 500; attempt += 1) {
      expect(generateVerificationCode()).toMatch(/^\d{6}$/);
    }
    expect(VERIFICATION_CODE_LENGTH).toBe(6);
  });

  it('keeps leading zeros, so 000042 is a valid code and not 42', () => {
    const codes = Array.from({ length: 5_000 }, () => generateVerificationCode());

    expect(codes.some((code) => code.startsWith('0'))).toBe(true);
    expect(codes.every((code) => code.length === VERIFICATION_CODE_LENGTH)).toBe(true);
  });

  it('is not predictable: consecutive codes differ', () => {
    const codes = new Set(Array.from({ length: 200 }, () => generateVerificationCode()));

    expect(codes.size).toBeGreaterThan(190);
  });
});
