import { maskPhoneNumber, normalizePhoneNumber } from './phone-number';

describe('normalizePhoneNumber', () => {
  it.each([
    ['600 111 222', '+34600111222'],
    ['600-111-222', '+34600111222'],
    ['+34 600 111 222', '+34600111222'],
    ['0034 600 111 222', '+34600111222'],
    ['+44 7700 900123', '+447700900123'],
    ['(+351) 912 345 678', '+351912345678'],
  ])('turns %s into %s', (raw, expected) => {
    expect(normalizePhoneNumber(raw)).toBe(expected);
  });

  it.each([
    '',
    'abc',
    '12345',
    '600 111',
    '+34 600 111 222 333 444 555',
    '600111222x',
    '++34600111222',
  ])('rejects %p', (raw) => {
    expect(normalizePhoneNumber(raw)).toBeNull();
  });
});

describe('maskPhoneNumber', () => {
  it('keeps the prefix and the last three digits', () => {
    expect(maskPhoneNumber('+34600111222')).toBe('+34 ••• ••• 222');
  });
});
