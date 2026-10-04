import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApplication } from './create-test-application';

describe('GET /health', () => {
  let application: NestFastifyApplication;

  beforeAll(async () => {
    application = await createTestApplication();
  });

  afterAll(async () => {
    await application.close();
  });

  it('responds 200 with status ok without requiring authentication', async () => {
    const response = await application.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('sends security headers on every response', async () => {
    const response = await application.inject({ method: 'GET', url: '/health' });

    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['strict-transport-security']).toBeDefined();
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('returns 404 for unknown routes', async () => {
    const response = await application.inject({ method: 'GET', url: '/does-not-exist' });

    expect(response.statusCode).toBe(404);
  });
});
