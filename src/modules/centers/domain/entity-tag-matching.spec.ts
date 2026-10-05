import { matchesIfNoneMatch } from './entity-tag-matching';

const ENTITY_TAG = '"abc123"';

describe('matchesIfNoneMatch', () => {
  it.each<[string | undefined, boolean]>([
    [undefined, false],
    ['', false],
    ['"abc123"', true],
    ['W/"abc123"', true],
    ['"other", "abc123"', true],
    ['*', true],
    ['"other"', false],
    ['abc123', false],
  ])('for header %p returns %p', (header, expected) => {
    expect(matchesIfNoneMatch(header, ENTITY_TAG)).toBe(expected);
  });
});
