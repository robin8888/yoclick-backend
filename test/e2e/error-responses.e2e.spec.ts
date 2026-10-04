import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { ErrorProbeModule } from '../support/error-probe.module';
import { createTestApplication } from './create-test-application';

const PROBLEM_CONTENT_TYPE = 'application/problem+json';
const OVER_ONE_MEGABYTE = 'x'.repeat(1_048_577);

describe('error responses (RFC 9457)', () => {
  let application: NestFastifyApplication;

  beforeAll(async () => {
    application = await createTestApplication({ extraModules: [ErrorProbeModule] });
  });

  afterAll(async () => {
    await application.close();
  });

  it('answers a domain error as problem+json with its stable code', async () => {
    const response = await application.inject({ method: 'GET', url: '/v1/probe/domain-error' });

    expect(response.statusCode).toBe(409);
    expect(response.headers['content-type']).toContain(PROBLEM_CONTENT_TYPE);
    expect(response.json()).toMatchObject({
      status: 409,
      code: 'CONFLICT',
      type: 'https://api.yoclick.app/errors/conflict',
    });
  });

  it('never leaks the internals of an unexpected failure (SEC-61)', async () => {
    const response = await application.inject({ method: 'GET', url: '/v1/probe/crash' });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ status: 500, code: 'INTERNAL_ERROR' });
    expect(response.body).not.toContain('S3cretPassw0rd');
    expect(response.body).not.toContain('postgres://');
    expect(response.body).not.toContain('at ');
  });

  it('gives each response a server-generated traceId, ignoring any sent by the client', async () => {
    const response = await application.inject({
      method: 'GET',
      url: '/v1/probe/crash',
      headers: { 'x-request-id': 'forged-by-client' },
    });

    const { traceId } = response.json<{ traceId: string }>();

    expect(traceId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('rejects an invalid body with the failing fields and no rejected values', async () => {
    const response = await application.inject({
      method: 'POST',
      url: '/v1/probe/echo',
      payload: { fullName: 'A', age: 3 },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(response.json<{ errors: unknown[] }>().errors).toEqual(
      expect.arrayContaining([
        { path: 'fullName', code: 'too_small' },
        { path: 'age', code: 'too_small' },
      ]),
    );
  });

  it('rejects fields the DTO does not declare, such as a forged role (BOPLA, SEC-48)', async () => {
    const response = await application.inject({
      method: 'POST',
      url: '/v1/probe/echo',
      payload: { fullName: 'Ana Pérez', age: 30, role: 'owner', centerId: 'someone-elses' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<{ errors: { code: string }[] }>().errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'unrecognized_keys' })]),
    );
  });

  it('accepts a valid body', async () => {
    const response = await application.inject({
      method: 'POST',
      url: '/v1/probe/echo',
      payload: { fullName: 'Ana Pérez', age: 30 },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ fullName: 'Ana Pérez' });
  });

  it('rejects a body over 1 MB with 413 problem+json (SEC-50)', async () => {
    const response = await application.inject({
      method: 'POST',
      url: '/v1/probe/echo',
      payload: { fullName: OVER_ONE_MEGABYTE, age: 30 },
    });

    expect(response.statusCode).toBe(413);
    expect(response.json()).toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
  });

  it('answers malformed JSON with a 400 problem, not a stack trace', async () => {
    const response = await application.inject({
      method: 'POST',
      url: '/v1/probe/echo',
      headers: { 'content-type': 'application/json' },
      payload: '{"fullName": ',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('answers an unknown route as a 404 problem', async () => {
    const response = await application.inject({ method: 'GET', url: '/does-not-exist' });

    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toContain(PROBLEM_CONTENT_TYPE);
    expect(response.json()).toMatchObject({ code: 'NOT_FOUND' });
  });
});
