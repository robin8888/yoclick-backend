import { parseEnvironment } from './parse-environment';

describe('parseEnvironment', () => {
  it('applies safe defaults when nothing is configured', () => {
    const environment = parseEnvironment({});

    expect(environment).toEqual({
      NODE_ENV: 'development',
      HOST: '127.0.0.1',
      PORT: 3000,
      LOG_LEVEL: 'info',
    });
  });

  it('coerces the port from a string, as environment variables always are', () => {
    expect(parseEnvironment({ PORT: '8080' }).PORT).toBe(8080);
  });

  it.each(['0', '65536', 'abc', '-1', '3000.5'])('rejects the invalid port %s', (invalidPort) => {
    expect(() => parseEnvironment({ PORT: invalidPort })).toThrow(/PORT/);
  });

  it('rejects an unknown NODE_ENV instead of silently running as development', () => {
    expect(() => parseEnvironment({ NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });

  it('rejects verbose log levels in production because they can leak data', () => {
    expect(() => parseEnvironment({ NODE_ENV: 'production', LOG_LEVEL: 'debug' })).toThrow(
      /LOG_LEVEL/,
    );
  });

  it('accepts info logging in production', () => {
    expect(parseEnvironment({ NODE_ENV: 'production', LOG_LEVEL: 'info' }).LOG_LEVEL).toBe('info');
  });

  it('lists every invalid variable at once so the operator fixes them in one pass', () => {
    expect(() => parseEnvironment({ PORT: 'abc', NODE_ENV: 'staging' })).toThrow(
      /PORT[\s\S]*NODE_ENV|NODE_ENV[\s\S]*PORT/,
    );
  });

  it('never echoes the rejected value, which could be a secret', () => {
    const secretLookingValue = 'sk_live_super_secret_value';

    let errorMessage = '';
    try {
      parseEnvironment({ PORT: secretLookingValue });
    } catch (error) {
      errorMessage = String(error);
    }

    expect(errorMessage).toContain('PORT');
    expect(errorMessage).not.toContain(secretLookingValue);
  });
});
