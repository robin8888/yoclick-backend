import { DomainError } from '../errors/domain-error';
import { parseIdempotencyKeyHeader } from './idempotency-key';

const VALID_KEY = '01a10685-b683-70b8-bc14-b2fed580d44c';

function captureError(action: () => unknown): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('parseIdempotencyKeyHeader', () => {
  it('returns a valid UUID key as it came', () => {
    expect(parseIdempotencyKeyHeader(VALID_KEY)).toBe(VALID_KEY);
  });

  it('normalizes the key to lower case so two spellings are the same key', () => {
    expect(parseIdempotencyKeyHeader(VALID_KEY.toUpperCase())).toBe(VALID_KEY);
  });

  it.each([undefined, '', '   ', 'not-a-uuid', '12345', `${VALID_KEY}-extra`, ['a', 'b']])(
    'answers 400 IDEMPOTENCY_KEY_REQUIRED for %p',
    (invalidHeader) => {
      const error = captureError(() => parseIdempotencyKeyHeader(invalidHeader));

      expect(error).toBeInstanceOf(DomainError);
      expect(error).toMatchObject({ code: 'IDEMPOTENCY_KEY_REQUIRED', httpStatus: 400 });
    },
  );
});
