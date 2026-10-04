import { z } from 'zod';
import { paginationQueryShape } from './pagination-query.schema';

const schema = z.strictObject(paginationQueryShape);

describe('pagination query', () => {
  it('defaults to 20 rows per page', () => {
    expect(schema.parse({})).toEqual({ limit: 20 });
  });

  it('coerces limit from the query string', () => {
    expect(schema.parse({ limit: '50' }).limit).toBe(50);
  });

  it.each(['0', '-1', '101', '1000000', 'abc', '2.5'])(
    'rejects limit %s (SEC-50: max 100)',
    (limit) => {
      expect(schema.safeParse({ limit }).success).toBe(false);
    },
  );

  it('accepts a cursor and rejects an oversized one', () => {
    expect(schema.parse({ cursor: 'abc' }).cursor).toBe('abc');
    expect(schema.safeParse({ cursor: 'a'.repeat(513) }).success).toBe(false);
  });

  it('is meant to be extended by strict endpoint schemas: unknown filters are rejected', () => {
    expect(schema.safeParse({ staffId: 'anything' }).success).toBe(false);
  });
});
