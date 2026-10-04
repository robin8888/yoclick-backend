import { parseEnvironment } from './parse-environment';

const DEVELOPMENT_DATABASE_URL = 'postgresql://yoclick_app:placeholder@localhost:5432/yoclick';
const PRODUCTION_DATABASE_URL =
  'postgresql://yoclick_app:placeholder@db.internal:5432/yoclick?sslmode=require';

function withDatabase(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { DATABASE_URL: DEVELOPMENT_DATABASE_URL, ...overrides };
}

describe('parseEnvironment', () => {
  it('applies safe defaults when nothing is configured', () => {
    const environment = parseEnvironment(withDatabase());

    expect(environment).toEqual({
      DATABASE_URL: DEVELOPMENT_DATABASE_URL,
      NODE_ENV: 'development',
      HOST: '127.0.0.1',
      PORT: 3000,
      LOG_LEVEL: 'info',
    });
  });

  it('coerces the port from a string, as environment variables always are', () => {
    expect(parseEnvironment(withDatabase({ PORT: '8080' })).PORT).toBe(8080);
  });

  it.each(['0', '65536', 'abc', '-1', '3000.5'])('rejects the invalid port %s', (invalidPort) => {
    expect(() => parseEnvironment(withDatabase({ PORT: invalidPort }))).toThrow(/PORT/);
  });

  it('rejects an unknown NODE_ENV instead of silently running as development', () => {
    expect(() => parseEnvironment(withDatabase({ NODE_ENV: 'staging' }))).toThrow(/NODE_ENV/);
  });

  it('rejects verbose log levels in production because they can leak data', () => {
    expect(() =>
      parseEnvironment(
        withDatabase({
          NODE_ENV: 'production',
          LOG_LEVEL: 'debug',
          DATABASE_URL: PRODUCTION_DATABASE_URL,
        }),
      ),
    ).toThrow(/LOG_LEVEL/);
  });

  it('accepts info logging in production', () => {
    expect(
      parseEnvironment(
        withDatabase({
          NODE_ENV: 'production',
          LOG_LEVEL: 'info',
          DATABASE_URL: PRODUCTION_DATABASE_URL,
        }),
      ).LOG_LEVEL,
    ).toBe('info');
  });

  it('lists every invalid variable at once so the operator fixes them in one pass', () => {
    expect(() => parseEnvironment(withDatabase({ PORT: 'abc', NODE_ENV: 'staging' }))).toThrow(
      /PORT[\s\S]*NODE_ENV|NODE_ENV[\s\S]*PORT/,
    );
  });

  it('never echoes the rejected value, which could be a secret', () => {
    const secretLookingValue = 'sk_live_super_secret_value';

    let errorMessage = '';
    try {
      parseEnvironment(withDatabase({ PORT: secretLookingValue }));
    } catch (error) {
      errorMessage = String(error);
    }

    expect(errorMessage).toContain('PORT');
    expect(errorMessage).not.toContain(secretLookingValue);
  });

  describe('DATABASE_URL', () => {
    it('is required: the API cannot run without a database', () => {
      expect(() => parseEnvironment({})).toThrow(/DATABASE_URL/);
    });

    it.each(['not-a-url', 'mysql://user:pass@localhost/db', 'http://localhost'])(
      'rejects %s because it is not a PostgreSQL URL',
      (invalidDatabaseUrl) => {
        expect(() => parseEnvironment({ DATABASE_URL: invalidDatabaseUrl })).toThrow(
          /DATABASE_URL/,
        );
      },
    );

    it('rejects a production database URL without TLS enforcement (SEC-63)', () => {
      expect(() =>
        parseEnvironment({ NODE_ENV: 'production', DATABASE_URL: DEVELOPMENT_DATABASE_URL }),
      ).toThrow(/TLS/);
    });

    it.each(['require', 'verify-ca', 'verify-full'])(
      'accepts sslmode=%s in production',
      (sslMode) => {
        const databaseUrl = `postgresql://yoclick_app:placeholder@db.internal/yoclick?sslmode=${sslMode}`;

        const environment = parseEnvironment({ NODE_ENV: 'production', DATABASE_URL: databaseUrl });

        expect(environment.DATABASE_URL).toBe(databaseUrl);
      },
    );

    it('never echoes the connection string, which contains the password', () => {
      let errorMessage = '';
      try {
        parseEnvironment({ DATABASE_URL: 'mysql://yoclick_app:SuperSecret123@localhost/db' });
      } catch (error) {
        errorMessage = String(error);
      }

      expect(errorMessage).toContain('DATABASE_URL');
      expect(errorMessage).not.toContain('SuperSecret123');
    });
  });
});
