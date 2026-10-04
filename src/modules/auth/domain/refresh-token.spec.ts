import { generateRefreshToken, hashRefreshToken } from './refresh-token';

describe('refresh tokens', () => {
  it('is opaque and URL-safe, with 256 bits of randomness', () => {
    const { token } = generateRefreshToken();

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('never repeats', () => {
    const tokens = new Set(Array.from({ length: 1_000 }, () => generateRefreshToken().token));

    expect(tokens.size).toBe(1_000);
  });

  it('returns the SHA-256 of the token as the only thing meant for storage', () => {
    const { token, tokenHash } = generateRefreshToken();

    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHash).toBe(hashRefreshToken(token));
    expect(tokenHash).not.toContain(token);
  });

  it('hashes the same token to the same value, so it can be looked up', () => {
    expect(hashRefreshToken('some-token')).toBe(hashRefreshToken('some-token'));
  });

  it('hashes different tokens to different values', () => {
    expect(hashRefreshToken('token-a')).not.toBe(hashRefreshToken('token-b'));
  });
});
