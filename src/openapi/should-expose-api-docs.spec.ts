import { shouldExposeApiDocs } from './should-expose-api-docs';

describe('shouldExposeApiDocs', () => {
  it.each([
    ['development', true],
    ['test', true],
    ['production', false],
  ] as const)('is %s -> %s (SEC-61: no interactive docs in production)', (nodeEnv, expected) => {
    expect(shouldExposeApiDocs(nodeEnv)).toBe(expected);
  });
});
