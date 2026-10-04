import { normalizeJoinCode } from './join-code';

describe('normalizeJoinCode', () => {
  it.each([
    ['NORTE7', 'NORTE7'],
    ['  norte7 ', 'NORTE7'],
    ['forja2', 'FORJA2'],
  ])('accepts %j as %j', (rawCode, expectedCode) => {
    expect(normalizeJoinCode(rawCode)).toBe(expectedCode);
  });

  it.each(['', 'NORTE', 'NORTE77', 'NOR TE', 'NORTE!', 'NORTE7--'])('rejects %j', (rawCode) => {
    expect(normalizeJoinCode(rawCode)).toBeNull();
  });
});
