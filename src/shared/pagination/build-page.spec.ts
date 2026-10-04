import { decodeCursor } from './cursor';
import { buildPage } from './build-page';
import { z } from 'zod';

interface Row {
  id: string;
}

const rows = (count: number): Row[] =>
  Array.from({ length: count }, (_, index) => ({ id: `row-${String(index + 1)}` }));
const toPosition = (row: Row): { id: string } => ({ id: row.id });
const positionSchema = z.strictObject({ id: z.string() });

describe('buildPage', () => {
  it('returns every row and no next cursor when fewer than the limit were fetched', () => {
    const page = buildPage({ fetchedRows: rows(3), limit: 5, toPosition });

    expect(page.data).toHaveLength(3);
    expect(page.nextCursor).toBeNull();
  });

  it('returns no next cursor when exactly the limit was fetched (nothing beyond it)', () => {
    const page = buildPage({ fetchedRows: rows(5), limit: 5, toPosition });

    expect(page.data).toHaveLength(5);
    expect(page.nextCursor).toBeNull();
  });

  it('drops the extra probe row and points the cursor at the last row of the page', () => {
    const page = buildPage({ fetchedRows: rows(6), limit: 5, toPosition });

    expect(page.data.map((row) => row.id)).toEqual(['row-1', 'row-2', 'row-3', 'row-4', 'row-5']);
    expect(page.nextCursor).not.toBeNull();
    expect(decodeCursor(page.nextCursor ?? '', positionSchema)).toEqual({ id: 'row-5' });
  });

  it('handles an empty result', () => {
    expect(buildPage({ fetchedRows: [], limit: 5, toPosition })).toEqual({
      data: [],
      nextCursor: null,
    });
  });
});
