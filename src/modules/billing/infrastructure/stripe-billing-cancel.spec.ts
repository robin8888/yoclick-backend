import { StripeBillingGateway } from './stripe-billing-gateway';

const SUBSCRIPTION_ID = 'sub_123';

function buildGateway(): StripeBillingGateway {
  return new StripeBillingGateway({
    secretKey: 'sk_test_x',
    webhookSecrets: [],
    successUrl: 'https://example.test/ok',
    cancelUrl: 'https://example.test/cancel',
    portalReturnUrl: 'https://example.test/back',
  });
}

function respondWith(status: number, body: unknown): jest.SpyInstance {
  return jest
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

describe('StripeBillingGateway.cancelSubscription', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('cancels the subscription at once with a DELETE', async () => {
    const fetchSpy = respondWith(200, { id: SUBSCRIPTION_ID, status: 'canceled' });

    await buildGateway().cancelSubscription(SUBSCRIPTION_ID);

    expect(fetchSpy).toHaveBeenCalledWith(
      `https://api.stripe.com/v1/subscriptions/${SUBSCRIPTION_ID}`,
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it.each([
    { name: 'the subscription no longer exists', status: 404, code: 'resource_missing' },
    { name: 'Stripe answers 404 without a code', status: 404, code: undefined },
  ])('is not a failure when $name', async ({ status, code }) => {
    respondWith(status, { error: { code, message: 'No such subscription' } });

    await expect(buildGateway().cancelSubscription(SUBSCRIPTION_ID)).resolves.toBeUndefined();
  });

  it('fails on any other Stripe error, so the center is not closed with the charge still running', async () => {
    respondWith(500, { error: { code: 'api_error', message: 'Stripe is down' } });

    await expect(buildGateway().cancelSubscription(SUBSCRIPTION_ID)).rejects.toThrow(
      /failed with status 500/,
    );
  });
});
