import {
  buildAlreadyRegisteredMessage,
  buildEmailVerificationMessage,
  buildPasswordResetMessage,
} from './account-email-messages';

const DETAILS = {
  to: 'ana@yopmail.com',
  fullName: 'Ana Pérez',
  code: '048213',
  validForMinutes: 15,
};

describe('account email messages', () => {
  it('puts the verification code and its validity in the text', () => {
    const message = buildEmailVerificationMessage(DETAILS);

    expect(message.to).toBe('ana@yopmail.com');
    expect(message.textBody).toContain('048213');
    expect(message.textBody).toContain('15 minutos');
  });

  it('puts the reset code in the password reset email', () => {
    const message = buildPasswordResetMessage({ ...DETAILS, validForMinutes: 30 });

    expect(message.textBody).toContain('048213');
    expect(message.textBody).toContain('30 minutos');
  });

  it.each([
    ['verification', buildEmailVerificationMessage(DETAILS)],
    ['reset', buildPasswordResetMessage(DETAILS)],
    ['already registered', buildAlreadyRegisteredMessage(DETAILS)],
  ])(
    'has no links in the %s email: the code is typed in the app, links are how phishing works',
    (_name, message) => {
      expect(message.textBody).not.toMatch(/https?:\/\//i);
      expect(message.textBody).not.toContain('<');
    },
  );

  it('warns never to share the code', () => {
    expect(buildEmailVerificationMessage(DETAILS).textBody).toContain('No compartas este código');
  });

  it('does not contain a code in the already-registered email', () => {
    expect(buildAlreadyRegisteredMessage(DETAILS).textBody).not.toMatch(/\d{6}/);
  });

  it('greets the person by name, in Spanish, with tuteo', () => {
    expect(buildEmailVerificationMessage(DETAILS).textBody).toMatch(/^Hola, Ana Pérez:/);
  });
});
