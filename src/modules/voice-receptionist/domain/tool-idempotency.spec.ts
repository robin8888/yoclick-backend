import { deriveBookingIdempotencyKey } from './tool-idempotency';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('deriveBookingIdempotencyKey', () => {
  it('is a valid UUID and always the same for the same call and tool call', () => {
    const first = deriveBookingIdempotencyKey('call-1', 'tool-1');

    expect(first).toMatch(UUID_PATTERN);
    expect(deriveBookingIdempotencyKey('call-1', 'tool-1')).toBe(first);
  });

  it('changes with the call or with the tool call', () => {
    const base = deriveBookingIdempotencyKey('call-1', 'tool-1');

    expect(deriveBookingIdempotencyKey('call-2', 'tool-1')).not.toBe(base);
    expect(deriveBookingIdempotencyKey('call-1', 'tool-2')).not.toBe(base);
  });

  it('does not confuse the boundary between the two ids', () => {
    expect(deriveBookingIdempotencyKey('a', 'bc')).not.toBe(deriveBookingIdempotencyKey('ab', 'c'));
  });
});
