import { createHmac } from 'node:crypto';
import { isValidStripeSignature } from './stripe-signature';

const SECRET = 'whsec_test';
const NOW = new Date('2026-10-14T10:00:00.000Z');
const NOW_SECONDS = NOW.getTime() / 1000;
const BODY = Buffer.from('{"type":"payment_intent.succeeded"}');

function sign(timestamp: number, body: Buffer = BODY, secret: string = SECRET): string {
  const signature = createHmac('sha256', secret)
    .update(Buffer.concat([Buffer.from(`${String(timestamp)}.`), body]))
    .digest('hex');
  return `t=${String(timestamp)},v1=${signature}`;
}

function check(signatureHeader: string | undefined, rawBody: Buffer = BODY): boolean {
  return isValidStripeSignature({ rawBody, signatureHeader, secret: SECRET, now: NOW });
}

describe('isValidStripeSignature', () => {
  it('accepts a fresh, correctly signed body', () => {
    expect(check(sign(NOW_SECONDS))).toBe(true);
  });

  it('accepts when one of several v1 signatures matches', () => {
    expect(check(`${sign(NOW_SECONDS)},v1=${'0'.repeat(64)}`)).toBe(true);
  });

  it.each([
    ['a missing header', undefined],
    ['a header without a signature', `t=${String(NOW_SECONDS)}`],
    ['garbage', 'hello'],
    ['another secret', sign(NOW_SECONDS, BODY, 'whsec_other')],
    ['a notice older than five minutes', sign(NOW_SECONDS - 301)],
  ])('rejects %s', (_caseName, header) => {
    expect(check(header)).toBe(false);
  });

  it('rejects a body changed after signing', () => {
    expect(check(sign(NOW_SECONDS), Buffer.from('{"type":"other"}'))).toBe(false);
  });
});
