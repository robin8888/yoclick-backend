import { isDisposableEmail } from './disposable-email-domains';

describe('isDisposableEmail', () => {
  it.each(['robin@yopmail.com', 'x@mailinator.com', 'a@guerrillamail.com'])(
    'flags %s when disposable addresses are not allowed',
    (email) => {
      expect(isDisposableEmail(email, { areDisposableEmailsAllowed: false })).toBe(true);
    },
  );

  it('does not flag an ordinary provider', () => {
    expect(isDisposableEmail('ana@gmail.com', { areDisposableEmailsAllowed: false })).toBe(false);
  });

  it('is case-insensitive on the domain', () => {
    expect(isDisposableEmail('robin@YOPMAIL.COM', { areDisposableEmailsAllowed: false })).toBe(
      true,
    );
  });

  it('flags nothing when disposable addresses are allowed, as in development and tests', () => {
    expect(isDisposableEmail('robin@yopmail.com', { areDisposableEmailsAllowed: true })).toBe(
      false,
    );
  });

  it('is not fooled by a subdomain trick like yopmail.com.evil.example', () => {
    expect(
      isDisposableEmail('a@yopmail.com.evil.example', { areDisposableEmailsAllowed: false }),
    ).toBe(false);
  });

  it('does not crash on a value without a domain', () => {
    expect(isDisposableEmail('not-an-email', { areDisposableEmailsAllowed: false })).toBe(false);
  });
});
