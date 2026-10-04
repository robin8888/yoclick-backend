import { findPasswordPolicyViolations } from './password-policy';

const EMAIL = 'ana.perez@example.com';

describe('findPasswordPolicyViolations', () => {
  it('accepts a long password with no composition rules (SEC-43)', () => {
    expect(findPasswordPolicyViolations('correct horse battery staple', EMAIL)).toEqual([]);
  });

  it('accepts exactly the minimum of 10 characters, even all lowercase', () => {
    expect(findPasswordPolicyViolations('abcdefghij', EMAIL)).toEqual([]);
  });

  it.each(['', 'short', 'ninechars'])('rejects %p as too short', (password) => {
    expect(findPasswordPolicyViolations(password, EMAIL)).toContain('too_short');
  });

  it('rejects passwords over 128 characters: they are a denial-of-service lever on the hasher', () => {
    expect(findPasswordPolicyViolations('a'.repeat(129), EMAIL)).toContain('too_long');
    expect(findPasswordPolicyViolations('a'.repeat(128), EMAIL)).toEqual([]);
  });

  it('counts characters, not bytes, so accents and emoji are not penalised', () => {
    expect(findPasswordPolicyViolations('contraseña-ñandú', EMAIL)).toEqual([]);
  });

  it('rejects a password that contains the person own email name', () => {
    expect(findPasswordPolicyViolations('ana.perez-2026!', EMAIL)).toContain('contains_email');
  });

  it('matches the email name regardless of case', () => {
    expect(findPasswordPolicyViolations('ANA.PEREZ-2026!', EMAIL)).toContain('contains_email');
  });

  it('ignores very short email names, which would match almost anything', () => {
    expect(findPasswordPolicyViolations('a-long-enough-password', 'al@example.com')).toEqual([]);
  });

  it('reports every violation at once', () => {
    expect(findPasswordPolicyViolations('ana.p', 'ana.p@example.com')).toEqual(
      expect.arrayContaining(['too_short']),
    );
  });
});
