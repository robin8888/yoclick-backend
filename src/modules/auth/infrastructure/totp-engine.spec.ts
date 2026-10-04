import * as OTPAuth from 'otpauth';
import { TotpEngine } from './totp-engine';

const STEP_SECONDS = 30;
const NOW = new Date('2026-10-04T12:00:10.000Z');

function codeAt(secret: string, moment: Date): string {
  return new OTPAuth.TOTP({
    algorithm: 'SHA1',
    digits: 6,
    period: STEP_SECONDS,
    secret: OTPAuth.Secret.fromBase32(secret),
  }).generate({ timestamp: moment.getTime() });
}

function offsetBySteps(moment: Date, steps: number): Date {
  return new Date(moment.getTime() + steps * STEP_SECONDS * 1_000);
}

describe('TotpEngine', () => {
  const engine = new TotpEngine();

  it('generates a base32 secret of 160 bits, as authenticator apps expect', () => {
    expect(engine.generateSecret()).toMatch(/^[A-Z2-7]{32}$/);
  });

  it('never repeats a secret', () => {
    const secrets = new Set(Array.from({ length: 200 }, () => engine.generateSecret()));

    expect(secrets.size).toBe(200);
  });

  it('builds the otpauth URI that authenticator apps import, naming issuer and account', () => {
    const uri = engine.buildProvisioningUri({
      secret: 'JBSWY3DPEHPK3PXP',
      accountName: 'ana@gmail.com',
    });

    expect(uri).toMatch(/^otpauth:\/\/totp\/Yoclick:ana%40gmail\.com\?/);
    expect(uri).toContain('secret=JBSWY3DPEHPK3PXP');
    expect(uri).toContain('issuer=Yoclick');
    expect(uri).toContain('digits=6');
    expect(uri).toContain('period=30');
  });

  it('accepts the current code and returns its time step', () => {
    const secret = engine.generateSecret();

    const step = engine.findMatchingStep(secret, codeAt(secret, NOW), NOW);

    expect(step).toBe(Math.floor(NOW.getTime() / (STEP_SECONDS * 1_000)));
  });

  it('tolerates one step of clock drift either way', () => {
    const secret = engine.generateSecret();

    expect(
      engine.findMatchingStep(secret, codeAt(secret, offsetBySteps(NOW, -1)), NOW),
    ).not.toBeNull();
    expect(
      engine.findMatchingStep(secret, codeAt(secret, offsetBySteps(NOW, 1)), NOW),
    ).not.toBeNull();
  });

  it('rejects codes two or more steps away: the window stays tight', () => {
    const secret = engine.generateSecret();

    expect(engine.findMatchingStep(secret, codeAt(secret, offsetBySteps(NOW, -2)), NOW)).toBeNull();
    expect(engine.findMatchingStep(secret, codeAt(secret, offsetBySteps(NOW, 2)), NOW)).toBeNull();
  });

  it('rejects a wrong code', () => {
    const secret = engine.generateSecret();
    const right = codeAt(secret, NOW);
    const wrong = right === '000000' ? '000001' : '000000';

    expect(engine.findMatchingStep(secret, wrong, NOW)).toBeNull();
  });

  it('rejects a code made with another secret', () => {
    const secret = engine.generateSecret();
    const otherSecret = engine.generateSecret();

    expect(engine.findMatchingStep(secret, codeAt(otherSecret, NOW), NOW)).toBeNull();
  });

  it.each(['', '12345', '1234567', 'abcdef', '12 345'])('rejects the malformed code %p', (code) => {
    expect(engine.findMatchingStep(engine.generateSecret(), code, NOW)).toBeNull();
  });
});
