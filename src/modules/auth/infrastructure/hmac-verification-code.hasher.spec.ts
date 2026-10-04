import { ConfigService } from '@nestjs/config';
import { type Environment } from '../../../shared/config/environment.schema';
import { HmacVerificationCodeHasher } from './hmac-verification-code.hasher';

function buildHasher(pepperFill: number): HmacVerificationCodeHasher {
  const pepper = Buffer.alloc(32, pepperFill).toString('base64');
  return new HmacVerificationCodeHasher(
    new ConfigService<Environment, true>({ AUTH_CODE_PEPPER_BASE64: pepper }),
  );
}

describe('HmacVerificationCodeHasher', () => {
  const hasher = buildHasher(1);

  it('never stores the code itself', () => {
    expect(hasher.hash('123456')).not.toContain('123456');
  });

  it('is a 64-character hex digest (HMAC-SHA-256)', () => {
    expect(hasher.hash('123456')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic for the same code and pepper, so it can be compared later', () => {
    expect(hasher.hash('123456')).toBe(hasher.hash('123456'));
  });

  it('differs for different codes', () => {
    expect(hasher.hash('123456')).not.toBe(hasher.hash('123457'));
  });

  it('depends on the secret pepper: the same code hashes differently with another one', () => {
    expect(buildHasher(1).hash('123456')).not.toBe(buildHasher(2).hash('123456'));
  });

  it('matches the right code and rejects a wrong one', () => {
    const storedHash = hasher.hash('123456');

    expect(hasher.matches('123456', storedHash)).toBe(true);
    expect(hasher.matches('654321', storedHash)).toBe(false);
  });

  it('rejects a malformed stored value instead of throwing', () => {
    expect(hasher.matches('123456', 'not-hex')).toBe(false);
    expect(hasher.matches('123456', '')).toBe(false);
  });

  it('rejects a hash made with another pepper (e.g. a leaked database cannot be reused elsewhere)', () => {
    expect(hasher.matches('123456', buildHasher(2).hash('123456'))).toBe(false);
  });
});
