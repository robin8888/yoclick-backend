import { generateRecoveryCodes, normalizeRecoveryCode, RECOVERY_CODE_COUNT } from './recovery-code';

describe('recovery codes', () => {
  it('generates ten codes', () => {
    expect(generateRecoveryCodes()).toHaveLength(RECOVERY_CODE_COUNT);
    expect(RECOVERY_CODE_COUNT).toBe(10);
  });

  it('formats each as two groups of five characters, easy to read and type', () => {
    for (const code of generateRecoveryCodes()) expect(code).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
  });

  it('avoids characters that look alike: no 0, 1, O, I or L', () => {
    const everyCharacter = generateRecoveryCodes().join('');

    expect(everyCharacter).not.toMatch(/[01OIL]/);
  });

  it('never repeats a code, within a set or across many sets', () => {
    const codes = Array.from({ length: 200 }, () => generateRecoveryCodes()).flat();

    expect(new Set(codes).size).toBe(codes.length);
  });

  describe('normalizeRecoveryCode', () => {
    it.each([
      ['abcde-fghjk', 'ABCDEFGHJK'],
      ['  ABCDE FGHJK  ', 'ABCDEFGHJK'],
      ['abcdefghjk', 'ABCDEFGHJK'],
      ['ABCDE-FGHJK', 'ABCDEFGHJK'],
    ])('treats %p as %p, so typing it with or without the dash both work', (input, expected) => {
      expect(normalizeRecoveryCode(input)).toBe(expected);
    });

    it('gives the same value for what was generated and what the person types', () => {
      const [code] = generateRecoveryCodes();

      expect(normalizeRecoveryCode((code ?? '').toLowerCase().replace('-', ' '))).toBe(
        normalizeRecoveryCode(code ?? ''),
      );
    });
  });
});
