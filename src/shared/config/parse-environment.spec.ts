import { parseEnvironment } from './parse-environment';

const DEVELOPMENT_DATABASE_URL = 'postgresql://yoclick_app:placeholder@localhost:5432/yoclick';
const PRODUCTION_DATABASE_URL =
  'postgresql://yoclick_app:placeholder@db.internal:5432/yoclick?sslmode=require';
const FAKE_KEY_BASE64 = Buffer.from('not-a-real-key').toString('base64');
const FAKE_PEPPER_BASE64 = Buffer.alloc(32, 7).toString('base64');
const FAKE_MFA_KEY_BASE64 = Buffer.alloc(32, 9).toString('base64');

/** Entorno de desarrollo válido; cada test cambia solo lo que quiere probar. */
function developmentEnvironment(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    DATABASE_URL: DEVELOPMENT_DATABASE_URL,
    JWT_ACCESS_PRIVATE_KEY_BASE64: FAKE_KEY_BASE64,
    JWT_ACCESS_PUBLIC_KEY_BASE64: FAKE_KEY_BASE64,
    AUTH_CODE_PEPPER_BASE64: FAKE_PEPPER_BASE64,
    MFA_ENCRYPTION_KEY_BASE64: FAKE_MFA_KEY_BASE64,
    ...overrides,
  };
}

function productionEnvironment(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return developmentEnvironment({
    NODE_ENV: 'production',
    DATABASE_URL: PRODUCTION_DATABASE_URL,
    JWT_KEY_ID: 'prod-2026-10',
    EMAIL_PROVIDER: 'brevo',
    BREVO_API_KEY: 'fake-api-key',
    EMAIL_FROM_ADDRESS: 'no-reply@yoclick.app',
    PUSH_PROVIDER: 'expo',
    ...overrides,
  });
}

function captureErrorMessage(rawEnvironment: Record<string, unknown>): string {
  try {
    parseEnvironment(rawEnvironment);
  } catch (error) {
    return String(error);
  }
  return '';
}

describe('parseEnvironment', () => {
  it('applies safe defaults when only the required variables are set', () => {
    const environment = parseEnvironment(developmentEnvironment());

    expect(environment).toMatchObject({
      NODE_ENV: 'development',
      HOST: '127.0.0.1',
      PORT: 3000,
      LOG_LEVEL: 'info',
      JWT_KEY_ID: 'dev-1',
    });
  });

  it('coerces the port from a string, as environment variables always are', () => {
    expect(parseEnvironment(developmentEnvironment({ PORT: '8080' })).PORT).toBe(8080);
  });

  it.each(['0', '65536', 'abc', '-1', '3000.5'])('rejects the invalid port %s', (invalidPort) => {
    expect(() => parseEnvironment(developmentEnvironment({ PORT: invalidPort }))).toThrow(/PORT/);
  });

  it('rejects an unknown NODE_ENV instead of silently running as development', () => {
    expect(() => parseEnvironment(developmentEnvironment({ NODE_ENV: 'staging' }))).toThrow(
      /NODE_ENV/,
    );
  });

  it('rejects verbose log levels in production because they can leak data', () => {
    expect(() => parseEnvironment(productionEnvironment({ LOG_LEVEL: 'debug' }))).toThrow(
      /LOG_LEVEL/,
    );
  });

  it('accepts a complete production environment', () => {
    expect(parseEnvironment(productionEnvironment()).NODE_ENV).toBe('production');
  });

  it('lists every invalid variable at once so the operator fixes them in one pass', () => {
    expect(() =>
      parseEnvironment(developmentEnvironment({ PORT: 'abc', NODE_ENV: 'staging' })),
    ).toThrow(/PORT[\s\S]*NODE_ENV|NODE_ENV[\s\S]*PORT/);
  });

  it('never echoes the rejected value, which could be a secret', () => {
    const secretLookingValue = 'sk_live_super_secret_value';

    const errorMessage = captureErrorMessage(developmentEnvironment({ PORT: secretLookingValue }));

    expect(errorMessage).toContain('PORT');
    expect(errorMessage).not.toContain(secretLookingValue);
  });

  describe('DATABASE_URL', () => {
    it('is required: the API cannot run without a database', () => {
      expect(captureErrorMessage(developmentEnvironment({ DATABASE_URL: undefined }))).toContain(
        'DATABASE_URL',
      );
    });

    it.each(['not-a-url', 'mysql://user:pass@localhost/db', 'http://localhost'])(
      'rejects %s because it is not a PostgreSQL URL',
      (invalidDatabaseUrl) => {
        expect(() =>
          parseEnvironment(developmentEnvironment({ DATABASE_URL: invalidDatabaseUrl })),
        ).toThrow(/DATABASE_URL/);
      },
    );

    it('rejects a production database URL without TLS enforcement (SEC-63)', () => {
      expect(() =>
        parseEnvironment(productionEnvironment({ DATABASE_URL: DEVELOPMENT_DATABASE_URL })),
      ).toThrow(/TLS/);
    });

    it.each(['require', 'verify-ca', 'verify-full'])(
      'accepts sslmode=%s in production',
      (sslMode) => {
        const databaseUrl = `postgresql://yoclick_app:placeholder@db.internal/yoclick?sslmode=${sslMode}`;

        const environment = parseEnvironment(productionEnvironment({ DATABASE_URL: databaseUrl }));

        expect(environment.DATABASE_URL).toBe(databaseUrl);
      },
    );

    it('never echoes the connection string, which contains the password', () => {
      const errorMessage = captureErrorMessage(
        developmentEnvironment({ DATABASE_URL: 'mysql://yoclick_app:SuperSecret123@localhost/db' }),
      );

      expect(errorMessage).toContain('DATABASE_URL');
      expect(errorMessage).not.toContain('SuperSecret123');
    });
  });

  describe('access token keys', () => {
    it.each(['JWT_ACCESS_PRIVATE_KEY_BASE64', 'JWT_ACCESS_PUBLIC_KEY_BASE64'])(
      'requires %s',
      (variableName) => {
        const errorMessage = captureErrorMessage(developmentEnvironment({ [variableName]: '' }));

        expect(errorMessage).toContain(variableName);
      },
    );

    it('rejects the development key id in production, so a dev key is never reused there', () => {
      expect(() => parseEnvironment(productionEnvironment({ JWT_KEY_ID: 'dev-1' }))).toThrow(
        /JWT_KEY_ID/,
      );
    });

    it('never echoes the private key', () => {
      const errorMessage = captureErrorMessage(
        developmentEnvironment({ PORT: 'abc', JWT_ACCESS_PRIVATE_KEY_BASE64: FAKE_KEY_BASE64 }),
      );

      expect(errorMessage).not.toContain(FAKE_KEY_BASE64);
    });
  });

  describe('MFA encryption key', () => {
    it.each([8, 16, 31, 33, 64])('rejects a key of %i bytes: AES-256 needs exactly 32', (size) => {
      const wrongSize = Buffer.alloc(size, 1).toString('base64');

      expect(() =>
        parseEnvironment(developmentEnvironment({ MFA_ENCRYPTION_KEY_BASE64: wrongSize })),
      ).toThrow(/MFA_ENCRYPTION_KEY_BASE64/);
    });

    it('is required', () => {
      expect(() =>
        parseEnvironment(developmentEnvironment({ MFA_ENCRYPTION_KEY_BASE64: undefined })),
      ).toThrow(/MFA_ENCRYPTION_KEY_BASE64/);
    });

    it('never echoes the key', () => {
      const wrongSize = Buffer.alloc(8, 1).toString('base64');

      const errorMessage = captureErrorMessage(
        developmentEnvironment({ MFA_ENCRYPTION_KEY_BASE64: wrongSize }),
      );

      expect(errorMessage).not.toContain(wrongSize);
    });
  });

  describe('authentication settings', () => {
    it('defaults to checking breached passwords, the console mailer and no disposable emails', () => {
      const environment = parseEnvironment(developmentEnvironment());

      expect(environment).toMatchObject({
        PASSWORD_BREACH_CHECK: 'enabled',
        RATE_LIMITING: 'enabled',
        EMAIL_PROVIDER: 'console',
        ALLOW_DISPOSABLE_EMAILS: false,
      });
    });

    it('turns ALLOW_DISPOSABLE_EMAILS=true into a boolean', () => {
      expect(
        parseEnvironment(developmentEnvironment({ ALLOW_DISPOSABLE_EMAILS: 'true' }))
          .ALLOW_DISPOSABLE_EMAILS,
      ).toBe(true);
    });

    it('requires a pepper of at least 32 bytes: a short one makes the code hash guessable', () => {
      const shortPepper = Buffer.alloc(8, 1).toString('base64');

      expect(() =>
        parseEnvironment(developmentEnvironment({ AUTH_CODE_PEPPER_BASE64: shortPepper })),
      ).toThrow(/AUTH_CODE_PEPPER_BASE64/);
    });

    it('never echoes the pepper', () => {
      const shortPepper = Buffer.alloc(8, 1).toString('base64');

      const errorMessage = captureErrorMessage(
        developmentEnvironment({ AUTH_CODE_PEPPER_BASE64: shortPepper }),
      );

      expect(errorMessage).not.toContain(shortPepper);
    });

    it.each(['BREVO_API_KEY', 'EMAIL_FROM_ADDRESS'])(
      'requires %s when the real email provider is selected',
      (variableName) => {
        expect(() =>
          parseEnvironment(
            developmentEnvironment({ EMAIL_PROVIDER: 'brevo', [variableName]: undefined }),
          ),
        ).toThrow(new RegExp(variableName));
      },
    );

    it('does not require provider credentials for the console mailer', () => {
      expect(() => parseEnvironment(developmentEnvironment())).not.toThrow();
    });

    it('never echoes the provider API key', () => {
      const errorMessage = captureErrorMessage(
        developmentEnvironment({
          EMAIL_PROVIDER: 'brevo',
          BREVO_API_KEY: 'xkeysib-super-secret',
          EMAIL_FROM_ADDRESS: 'not-an-email',
        }),
      );

      expect(errorMessage).not.toContain('xkeysib-super-secret');
    });

    it.each([
      ['RATE_LIMITING', 'disabled'],
      ['PASSWORD_BREACH_CHECK', 'disabled'],
      ['EMAIL_PROVIDER', 'console'],
      ['PUSH_PROVIDER', 'console'],
      ['ALLOW_DISPOSABLE_EMAILS', 'true'],
    ])('rejects %s=%s in production', (variableName, unsafeValue) => {
      expect(() =>
        parseEnvironment(productionEnvironment({ [variableName]: unsafeValue })),
      ).toThrow(new RegExp(variableName));
    });
  });
});
