import { ConfigService } from '@nestjs/config';
import { type Environment } from '../config/environment.schema';
import { BrevoEmailSender } from './brevo-email-sender';
import { EmailDeliveryError } from './email-sender';

const MESSAGE = {
  to: 'ana@yopmail.com',
  subject: 'Tu código de verificación',
  textBody: 'Tu código es 123456',
};

function buildSender(): BrevoEmailSender {
  const configuration = {
    BREVO_API_KEY: 'xkeysib-secret-key',
    EMAIL_FROM_ADDRESS: 'no-reply@yoclick.app',
    EMAIL_FROM_NAME: 'Yoclick',
  };
  return new BrevoEmailSender(new ConfigService<Environment, true>(configuration));
}

function mockFetchResponse(response: Partial<Response>): jest.SpyInstance {
  return jest.spyOn(globalThis, 'fetch').mockResolvedValue(response as Response);
}

describe('BrevoEmailSender', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('posts the message to the Brevo API with the key in the header, not in the URL', async () => {
    const fetchSpy = mockFetchResponse({ ok: true, status: 201 });

    await buildSender().send(MESSAGE);

    const [url, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(url).not.toContain('xkeysib');
    expect((options.headers as Record<string, string>)['api-key']).toBe('xkeysib-secret-key');
    expect(JSON.parse(options.body as string)).toEqual({
      sender: { name: 'Yoclick', email: 'no-reply@yoclick.app' },
      to: [{ email: 'ana@yopmail.com' }],
      subject: 'Tu código de verificación',
      textContent: 'Tu código es 123456',
    });
  });

  it('sets a timeout so a stuck provider cannot hang the request', async () => {
    const fetchSpy = mockFetchResponse({ ok: true, status: 201 });

    await buildSender().send(MESSAGE);

    const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it('fails with the provider status only: no body, recipient, subject or key in the error', async () => {
    mockFetchResponse({
      ok: false,
      status: 401,
      text: () =>
        Promise.resolve('{"message":"Key xkeysib-secret-key is invalid for ana@yopmail.com"}'),
    });

    const error = await buildSender()
      .send(MESSAGE)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(EmailDeliveryError);
    expect(error).toMatchObject({ providerStatusCode: 401 });
    const printable = `${String(error)} ${JSON.stringify(error)}`;
    expect(printable).not.toContain('xkeysib');
    expect(printable).not.toContain('ana@yopmail.com');
    expect(printable).not.toContain('123456');
  });

  it('turns a network failure into the same delivery error', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('getaddrinfo ENOTFOUND api.brevo.com'));

    await expect(buildSender().send(MESSAGE)).rejects.toBeInstanceOf(EmailDeliveryError);
  });
});
