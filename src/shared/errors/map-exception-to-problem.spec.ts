import { HttpException, NotFoundException } from '@nestjs/common';
import { ZodValidationException } from 'nestjs-zod';
import { z } from 'zod';
import { DomainError } from './domain-error';
import { mapExceptionToProblem } from './map-exception-to-problem';

const TRACE_ID = 'trace-123';

function captureZodException(): ZodValidationException {
  const schema = z.strictObject({ email: z.email(), age: z.number().int().min(18) });
  const parsingResult = schema.safeParse({ email: 'not-an-email', age: 3, role: 'admin' });
  if (parsingResult.success) throw new Error('the fixture must be invalid');
  return new ZodValidationException(parsingResult.error);
}

describe('mapExceptionToProblem', () => {
  it('maps a domain error to its own code and status with the Spanish catalog title', () => {
    const problem = mapExceptionToProblem(new DomainError('NOT_FOUND', 404), TRACE_ID);

    expect(problem).toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
      title: 'No encontramos lo que buscas',
      traceId: TRACE_ID,
      type: 'https://api.yoclick.app/errors/not-found',
    });
  });

  it('carries the failing field of a domain error, without the rejected value', () => {
    const error = new DomainError('VALIDATION_FAILED', 400, [
      { path: 'password', code: 'too_short' },
    ]);

    const problem = mapExceptionToProblem(error, TRACE_ID);

    expect(problem.errors).toEqual([{ path: 'password', code: 'too_short' }]);
  });

  it('turns zod validation failures into field errors without echoing the rejected values', () => {
    const problem = mapExceptionToProblem(captureZodException(), TRACE_ID);

    expect(problem.status).toBe(400);
    expect(problem.code).toBe('VALIDATION_FAILED');
    expect(problem.errors).toEqual(
      expect.arrayContaining([
        { path: 'email', code: 'invalid_format' },
        { path: 'age', code: 'too_small' },
      ]),
    );
    expect(JSON.stringify(problem)).not.toContain('not-an-email');
  });

  it('reports unknown keys sent to a strict DTO instead of silently ignoring them (BOPLA)', () => {
    const problem = mapExceptionToProblem(captureZodException(), TRACE_ID);

    expect(problem.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'unrecognized_keys' })]),
    );
  });

  it.each([
    [400, 'BAD_REQUEST'],
    [401, 'UNAUTHENTICATED'],
    [403, 'FORBIDDEN'],
    [404, 'NOT_FOUND'],
    [405, 'METHOD_NOT_ALLOWED'],
    [409, 'CONFLICT'],
    [413, 'PAYLOAD_TOO_LARGE'],
    [415, 'UNSUPPORTED_MEDIA_TYPE'],
    [429, 'RATE_LIMITED'],
  ])('maps the HTTP status %i to the code %s', (status, expectedCode) => {
    const problem = mapExceptionToProblem(new HttpException('anything', status), TRACE_ID);

    expect(problem.status).toBe(status);
    expect(problem.code).toBe(expectedCode);
  });

  it('never forwards the message of a framework exception, which may reveal internals', () => {
    const problem = mapExceptionToProblem(
      new NotFoundException('Cannot GET /secret/internal/path'),
      TRACE_ID,
    );

    expect(JSON.stringify(problem)).not.toContain('/secret/internal/path');
  });

  it('maps errors raised by Fastify itself, such as a body over the limit', () => {
    const fastifyLikeError = Object.assign(new Error('Request body is too large'), {
      statusCode: 413,
    });

    const problem = mapExceptionToProblem(fastifyLikeError, TRACE_ID);

    expect(problem).toMatchObject({ status: 413, code: 'PAYLOAD_TOO_LARGE' });
  });

  it('answers an unexpected error with a generic 500 and none of its details', () => {
    const databaseError = new Error('duplicate key value violates "users_email_key" (ana@x.com)');

    const problem = mapExceptionToProblem(databaseError, TRACE_ID);

    expect(problem).toMatchObject({ status: 500, code: 'INTERNAL_ERROR', traceId: TRACE_ID });
    expect(JSON.stringify(problem)).not.toContain('users_email_key');
    expect(JSON.stringify(problem)).not.toContain('ana@x.com');
  });

  it('treats a thrown non-Error value as an internal error too', () => {
    expect(mapExceptionToProblem('boom', TRACE_ID)).toMatchObject({
      status: 500,
      code: 'INTERNAL_ERROR',
    });
  });
});
