import { ConfigService } from '@nestjs/config';
import { type Environment } from '../config/environment.schema';
import { SecretEncryptor } from './secret-encryptor';

function buildEncryptor(keyFill: number): SecretEncryptor {
  const key = Buffer.alloc(32, keyFill).toString('base64');
  return new SecretEncryptor(
    new ConfigService<Environment, true>({ MFA_ENCRYPTION_KEY_BASE64: key }),
  );
}

const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

describe('SecretEncryptor', () => {
  const encryptor = buildEncryptor(1);

  it('gives back exactly what was encrypted', () => {
    expect(encryptor.decrypt(encryptor.encrypt(SECRET))).toBe(SECRET);
  });

  it('never leaves the secret readable in what is stored', () => {
    expect(encryptor.encrypt(SECRET)).not.toContain(SECRET);
  });

  it('is versioned, so the key or the algorithm can be rotated later', () => {
    expect(encryptor.encrypt(SECRET)).toMatch(/^v1\./);
  });

  it('encrypts the same secret differently every time (fresh random IV)', () => {
    expect(encryptor.encrypt(SECRET)).not.toBe(encryptor.encrypt(SECRET));
  });

  it('handles accents and any unicode', () => {
    expect(encryptor.decrypt(encryptor.encrypt('contraseña ñandú ✓'))).toBe('contraseña ñandú ✓');
  });

  it('detects tampering with the ciphertext (authenticated encryption)', () => {
    const [version, iv, tag, ciphertext] = encryptor.encrypt(SECRET).split('.');
    const flipped = Buffer.from(ciphertext ?? '', 'base64url');
    flipped[0] = (flipped[0] ?? 0) ^ 0xff;

    const tampered = [version, iv, tag, flipped.toString('base64url')].join('.');

    expect(() => encryptor.decrypt(tampered)).toThrow();
  });

  it('detects tampering with the authentication tag', () => {
    const [version, iv, , ciphertext] = encryptor.encrypt(SECRET).split('.');
    const forgedTag = Buffer.alloc(16, 0).toString('base64url');

    expect(() => encryptor.decrypt([version, iv, forgedTag, ciphertext].join('.'))).toThrow();
  });

  it('cannot be decrypted with a different key', () => {
    const encrypted = encryptor.encrypt(SECRET);

    expect(() => buildEncryptor(2).decrypt(encrypted)).toThrow();
  });

  it.each(['', 'v1.only.three', 'v2.a.b.c', 'not-an-encrypted-value'])(
    'rejects the malformed value %p',
    (malformed) => {
      expect(() => encryptor.decrypt(malformed)).toThrow();
    },
  );

  it('does not put the key or the secret in the error message', () => {
    let message = '';
    try {
      encryptor.decrypt('v1.AAAA.BBBB.CCCC');
    } catch (error) {
      message = String(error);
    }

    expect(message).not.toContain(SECRET);
    expect(message).not.toContain(Buffer.alloc(32, 1).toString('base64'));
  });
});
