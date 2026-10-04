import { encodeCursor } from './cursor';

export interface Page<TItem> {
  readonly data: readonly TItem[];
  readonly nextCursor: string | null;
}

interface BuildPageInput<TRow> {
  /** Filas pedidas a la base de datos con `limit + 1`: la sobrante solo indica que hay más. */
  readonly fetchedRows: readonly TRow[];
  readonly limit: number;
  readonly toPosition: (lastRow: TRow) => object;
}

export function buildPage<TRow>(input: BuildPageInput<TRow>): Page<TRow> {
  const { fetchedRows, limit, toPosition } = input;
  const hasMoreRows = fetchedRows.length > limit;
  if (!hasMoreRows) return { data: fetchedRows, nextCursor: null };

  const pageRows = fetchedRows.slice(0, limit);
  const lastRowOfPage = pageRows.at(-1);
  if (lastRowOfPage === undefined) return { data: pageRows, nextCursor: null };

  return { data: pageRows, nextCursor: encodeCursor(toPosition(lastRowOfPage)) };
}
