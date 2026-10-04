import { computeRequestFingerprint } from './request-fingerprint';

describe('computeRequestFingerprint', () => {
  const OPERATION = 'POST /v1/bookings';

  it('is the same for the same operation and body', () => {
    const first = computeRequestFingerprint(OPERATION, { serviceId: 'a', startsAt: 'x' });
    const second = computeRequestFingerprint(OPERATION, { serviceId: 'a', startsAt: 'x' });

    expect(first).toBe(second);
  });

  it('does not depend on the order of the keys in the body', () => {
    const first = computeRequestFingerprint(OPERATION, { serviceId: 'a', startsAt: 'x' });
    const second = computeRequestFingerprint(OPERATION, { startsAt: 'x', serviceId: 'a' });

    expect(first).toBe(second);
  });

  it('does not depend on key order in nested objects either', () => {
    const first = computeRequestFingerprint(OPERATION, { slot: { from: 1, to: 2 } });
    const second = computeRequestFingerprint(OPERATION, { slot: { to: 2, from: 1 } });

    expect(first).toBe(second);
  });

  it('changes when a value changes', () => {
    const first = computeRequestFingerprint(OPERATION, { serviceId: 'a' });
    const second = computeRequestFingerprint(OPERATION, { serviceId: 'b' });

    expect(first).not.toBe(second);
  });

  it('changes when the operation changes, so a key cannot be replayed on another endpoint', () => {
    const body = { serviceId: 'a' };

    expect(computeRequestFingerprint('POST /v1/bookings', body)).not.toBe(
      computeRequestFingerprint('POST /v1/payments', body),
    );
  });

  it('keeps array order, which is meaningful', () => {
    expect(computeRequestFingerprint(OPERATION, { ids: [1, 2] })).not.toBe(
      computeRequestFingerprint(OPERATION, { ids: [2, 1] }),
    );
  });

  it('treats an absent body and an empty object as the same request', () => {
    expect(computeRequestFingerprint(OPERATION, undefined)).toBe(
      computeRequestFingerprint(OPERATION, {}),
    );
  });
});
