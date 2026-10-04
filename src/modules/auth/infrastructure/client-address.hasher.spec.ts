import { ConfigService } from '@nestjs/config';
import { type Environment } from '../../../shared/config/environment.schema';
import { ClientAddressHasher } from './client-address.hasher';
import { HmacVerificationCodeHasher } from './hmac-verification-code.hasher';

function buildConfig(fill: number): ConfigService<Environment, true> {
  const pepper = Buffer.alloc(32, fill).toString('base64');
  return new ConfigService<Environment, true>({ AUTH_CODE_PEPPER_BASE64: pepper });
}

describe('ClientAddressHasher', () => {
  const hasher = new ClientAddressHasher(buildConfig(1));

  it('never contains the address', () => {
    expect(hasher.hash('203.0.113.7')).not.toContain('203.0.113.7');
  });

  it('is stable for the same address, so the evidence can be matched later', () => {
    expect(hasher.hash('203.0.113.7')).toBe(hasher.hash('203.0.113.7'));
  });

  it('differs between addresses', () => {
    expect(hasher.hash('203.0.113.7')).not.toBe(hasher.hash('203.0.113.8'));
  });

  it('depends on the secret pepper, so it cannot be reversed by trying every IPv4 address', () => {
    expect(new ClientAddressHasher(buildConfig(2)).hash('203.0.113.7')).not.toBe(
      hasher.hash('203.0.113.7'),
    );
  });

  it('never equals a verification code hash for the same text (separate context)', () => {
    const codeHasher = new HmacVerificationCodeHasher(buildConfig(1));

    expect(hasher.hash('123456')).not.toBe(codeHasher.hash('123456'));
  });
});
