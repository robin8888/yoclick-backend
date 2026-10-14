import {
  EMAIL_SECOND_FACTOR_CODE_TTL_MINUTES,
  isResendTooSoon,
  listLoginMethods,
  maskEmailAddress,
} from './email-second-factor';

describe('maskEmailAddress', () => {
  it.each([
    ['robin@yopmail.com', 'r***@yopmail.com'],
    ['a@b.es', 'a***@b.es'],
    ['ana.lopez+x@correo.example.org', 'a***@correo.example.org'],
    ['sin-arroba', '***'],
  ])('masks %s as %s', (email, expected) => {
    expect(maskEmailAddress(email)).toBe(expected);
  });
});

describe('isResendTooSoon', () => {
  const now = new Date('2026-11-06T10:00:00Z');

  it.each([
    [0, true],
    [59, true],
    [60, false],
    [61, false],
    [600, false],
  ])('after %i seconds the answer is %s', (secondsAgo, expected) => {
    const lastIssuedAt = new Date(now.getTime() - secondsAgo * 1000);
    expect(isResendTooSoon(lastIssuedAt, now)).toBe(expected);
  });
});

describe('listLoginMethods', () => {
  it('offers the email as an alternative to the authenticator app', () => {
    expect(listLoginMethods('totp')).toEqual(['totp', 'email']);
  });

  it('offers only the email to whoever chose it', () => {
    expect(listLoginMethods('email')).toEqual(['email']);
  });
});

describe('email code lifetime', () => {
  it('is ten minutes', () => {
    expect(EMAIL_SECOND_FACTOR_CODE_TTL_MINUTES).toBe(10);
  });
});
