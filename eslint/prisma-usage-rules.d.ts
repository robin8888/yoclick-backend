import type { Linter } from 'eslint';

export function buildPrismaImportRestrictionBlocks(): Linter.Config[];

export const UNSAFE_RAW_QUERY_SELECTORS: readonly { selector: string; message: string }[];
