import pino from 'pino';
import { LOG_REDACTION, serializeRequestForLog } from './log-redaction';

function captureLogLine(logPayload: Record<string, unknown>): Record<string, unknown> {
  const capturedLines: string[] = [];
  const logger = pino(
    { redact: LOG_REDACTION },
    { write: (line: string) => capturedLines.push(line) },
  );

  logger.info(logPayload, 'test');

  return JSON.parse(capturedLines[0] ?? '{}') as Record<string, unknown>;
}

describe('log redaction', () => {
  it.each(['password', 'token', 'accessToken', 'refreshToken', 'email', 'phone', 'authorization'])(
    'redacts %s at the top level of a log entry',
    (sensitiveKey) => {
      const logLine = captureLogLine({ [sensitiveKey]: 'sensitive-value' });

      expect(logLine[sensitiveKey]).toBe('[REDACTED]');
    },
  );

  it('redacts sensitive keys one level deep, such as inside a user object', () => {
    const logLine = captureLogLine({ user: { email: 'ana@example.com', fullName: 'Ana' } });

    expect(logLine['user']).toEqual({ email: '[REDACTED]', fullName: 'Ana' });
  });

  it('redacts health information wherever it appears', () => {
    const logLine = captureLogLine({ client: { health: { allergies: 'penicillin' } } });

    expect(JSON.stringify(logLine)).not.toContain('penicillin');
  });
});

describe('serializeRequestForLog', () => {
  it('keeps only id, method and path', () => {
    const serialized = serializeRequestForLog({
      id: 'request-1',
      method: 'GET',
      url: '/v1/bookings',
      headers: { authorization: 'Bearer secret-token' },
    });

    expect(serialized).toEqual({ id: 'request-1', method: 'GET', path: '/v1/bookings' });
  });

  it('drops the query string because it can carry tokens or emails', () => {
    const serialized = serializeRequestForLog({
      id: 'request-2',
      method: 'POST',
      url: '/v1/auth/email/verify?token=abc123&email=ana@example.com',
    });

    expect(serialized.path).toBe('/v1/auth/email/verify');
    expect(JSON.stringify(serialized)).not.toContain('abc123');
  });
});
