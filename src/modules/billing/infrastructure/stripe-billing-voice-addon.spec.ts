import { StripeBillingGateway } from './stripe-billing-gateway';

const API = 'https://api.stripe.com/v1';

function buildGateway(): StripeBillingGateway {
  return new StripeBillingGateway({
    secretKey: 'sk_test_x',
    webhookSecrets: [],
    successUrl: 'https://example.test/ok',
    cancelUrl: 'https://example.test/cancel',
    portalReturnUrl: 'https://example.test/back',
  });
}

function describeRequestTarget(input: string | URL | Request): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

interface RecordedCall {
  readonly method: string;
  readonly path: string;
  readonly form: URLSearchParams;
  readonly idempotencyKey: string | null;
  readonly stripeVersion: string | null;
}

type Responder = (call: RecordedCall) => { status: number; body: unknown } | undefined;

/** Un Stripe de mentira: cada llamada se apunta y la contesta quien la reconozca; lo demás es un 404. */
function stubStripe(responders: readonly Responder[]): RecordedCall[] {
  const calls: RecordedCall[] = [];
  jest.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = describeRequestTarget(input);
    const headers = new Headers(init?.headers);
    const call: RecordedCall = {
      method: init?.method ?? 'GET',
      path: url.slice(API.length),
      form: new URLSearchParams(init?.body as URLSearchParams | undefined),
      idempotencyKey: headers.get('idempotency-key'),
      stripeVersion: headers.get('stripe-version'),
    };
    calls.push(call);
    const answer = responders.map((respond) => respond(call)).find((found) => found !== undefined);
    const { status, body } = answer ?? {
      status: 404,
      body: { error: { code: 'resource_missing', message: 'No such thing' } },
    };
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  });
  return calls;
}

const bodyOf = (calls: readonly RecordedCall[], method: string, pathStart: string) =>
  calls.filter((call) => call.method === method && call.path.startsWith(pathStart));

describe('StripeBillingGateway voice add-on', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('syncVoiceAddon', () => {
    const specs = [
      { planId: 'basic', monthlyPriceCents: 4900, overageCentsPerMinute: 35 },
      { planId: 'pro', monthlyPriceCents: 6900, overageCentsPerMinute: 35 },
    ];

    it('creates the product, one minutes meter and, per tier, the monthly fee and the metered minute price', async () => {
      let priceCount = 0;
      const calls = stubStripe([
        (call) =>
          call.method === 'POST' && call.path === '/products'
            ? { status: 200, body: { id: 'yoclick_voice_addon' } }
            : undefined,
        (call) =>
          call.method === 'GET' && call.path.startsWith('/billing/meters')
            ? { status: 200, body: { data: [] } }
            : undefined,
        (call) =>
          call.method === 'POST' && call.path === '/billing/meters'
            ? { status: 200, body: { id: 'mtr_1' } }
            : undefined,
        (call) =>
          call.method === 'GET' && call.path.startsWith('/prices')
            ? { status: 200, body: { data: [] } }
            : undefined,
        (call) => {
          if (call.method !== 'POST' || call.path !== '/prices') return undefined;
          priceCount += 1;
          return { status: 200, body: { id: `price_${String(priceCount)}` } };
        },
      ]);

      const synced = await buildGateway().syncVoiceAddon(specs);

      expect(synced).toEqual([
        { planId: 'basic', monthlyPriceId: 'price_1', overagePriceId: 'price_2' },
        { planId: 'pro', monthlyPriceId: 'price_3', overagePriceId: 'price_4' },
      ]);
      const [meter] = bodyOf(calls, 'POST', '/billing/meters');
      expect(Object.fromEntries(meter?.form ?? [])).toMatchObject({
        event_name: 'yoclick_voice_minutes',
        'default_aggregation[formula]': 'sum',
        'customer_mapping[type]': 'by_id',
        'customer_mapping[event_payload_key]': 'stripe_customer_id',
        'value_settings[event_payload_key]': 'value',
      });
      const [fee, overage] = bodyOf(calls, 'POST', '/prices').map((call) =>
        Object.fromEntries(call.form),
      );
      expect(fee).toMatchObject({
        unit_amount: '4900',
        'recurring[interval]': 'month',
        tax_behavior: 'exclusive',
        lookup_key: 'yoclick_voice_basic_monthly_4900',
      });
      expect(fee).not.toHaveProperty('recurring[meter]');
      expect(overage).toMatchObject({
        unit_amount: '35',
        billing_scheme: 'per_unit',
        'recurring[usage_type]': 'metered',
        'recurring[meter]': 'mtr_1',
        'recurring[interval]': 'month',
        lookup_key: 'yoclick_voice_basic_overage_35',
      });
    });

    it('creates nothing again when the product, the meter and the prices already exist', async () => {
      const calls = stubStripe([
        (call) =>
          call.method === 'GET' && call.path === '/products/yoclick_voice_addon'
            ? { status: 200, body: { id: 'yoclick_voice_addon' } }
            : undefined,
        (call) =>
          call.method === 'GET' && call.path.startsWith('/billing/meters')
            ? {
                status: 200,
                body: { data: [{ id: 'mtr_9', event_name: 'yoclick_voice_minutes' }] },
              }
            : undefined,
        (call) =>
          call.method === 'GET' && call.path.startsWith('/prices')
            ? { status: 200, body: { data: [{ id: 'price_existing', metadata: {} }] } }
            : undefined,
      ]);

      const synced = await buildGateway().syncVoiceAddon(specs.slice(0, 1));

      expect(synced).toEqual([
        { planId: 'basic', monthlyPriceId: 'price_existing', overagePriceId: 'price_existing' },
      ]);
      expect(calls.filter((call) => call.method === 'POST')).toEqual([]);
    });
  });

  describe('attachVoiceAddon', () => {
    const input = {
      subscriptionId: 'sub_1',
      monthlyPriceId: 'price_fee',
      overagePriceId: 'price_minutes',
      taxRateId: 'txr_1',
    };
    const subscription = (items: unknown[]) => ({
      status: 200,
      body: {
        id: 'sub_1',
        current_period_start: 1_760_000_000,
        current_period_end: 1_762_592_000,
        items: { data: items },
      },
    });

    it('adds both lines to the subscription the center already has, with the VAT, and reads its billing period', async () => {
      let itemCount = 0;
      const calls = stubStripe([
        (call) =>
          call.method === 'GET' && call.path === '/subscriptions/sub_1'
            ? subscription([
                { id: 'si_plan', price: { id: 'price_plan', product: 'yoclick_plan_pro' } },
              ])
            : undefined,
        (call) => {
          if (call.method !== 'POST' || call.path !== '/subscription_items') return undefined;
          itemCount += 1;
          return { status: 200, body: { id: `si_${String(itemCount)}` } };
        },
      ]);

      const attachment = await buildGateway().attachVoiceAddon(input);

      expect(attachment).toEqual({
        itemId: 'si_1',
        overageItemId: 'si_2',
        periodStart: new Date(1_760_000_000_000),
        periodEnd: new Date(1_762_592_000_000),
      });
      const [fee, minutes] = bodyOf(calls, 'POST', '/subscription_items').map((call) =>
        Object.fromEntries(call.form),
      );
      expect(fee).toMatchObject({
        subscription: 'sub_1',
        price: 'price_fee',
        quantity: '1',
        'tax_rates[0]': 'txr_1',
      });
      expect(minutes).toMatchObject({
        subscription: 'sub_1',
        price: 'price_minutes',
        'tax_rates[0]': 'txr_1',
      });
      expect(minutes).not.toHaveProperty('quantity');
    });

    it('does not add a line twice: repeating it reuses the ones that are already there', async () => {
      const calls = stubStripe([
        (call) =>
          call.method === 'GET' && call.path === '/subscriptions/sub_1'
            ? subscription([
                {
                  id: 'si_fee',
                  price: { id: 'price_fee', product: 'yoclick_voice_addon', recurring: {} },
                },
                {
                  id: 'si_minutes',
                  price: {
                    id: 'price_minutes',
                    product: 'yoclick_voice_addon',
                    recurring: { usage_type: 'metered' },
                  },
                },
              ])
            : undefined,
      ]);

      const attachment = await buildGateway().attachVoiceAddon(input);

      expect(attachment).toMatchObject({ itemId: 'si_fee', overageItemId: 'si_minutes' });
      expect(calls.filter((call) => call.method === 'POST')).toEqual([]);
    });

    it('takes the billing period from the lines when the subscription does not carry it', async () => {
      stubStripe([
        (call) =>
          call.method === 'GET' && call.path === '/subscriptions/sub_1'
            ? {
                status: 200,
                body: {
                  id: 'sub_1',
                  items: {
                    data: [
                      {
                        id: 'si_fee',
                        current_period_start: 1_760_000_000,
                        current_period_end: 1_762_592_000,
                        price: { id: 'price_fee', product: 'yoclick_voice_addon' },
                      },
                      {
                        id: 'si_minutes',
                        price: {
                          id: 'price_minutes',
                          product: 'yoclick_voice_addon',
                          recurring: { usage_type: 'metered' },
                        },
                      },
                    ],
                  },
                },
              }
            : undefined,
      ]);

      const attachment = await buildGateway().attachVoiceAddon(input);

      expect(attachment.periodStart).toEqual(new Date(1_760_000_000_000));
      expect(attachment.periodEnd).toEqual(new Date(1_762_592_000_000));
    });
  });

  describe('changeVoiceAddonTier', () => {
    it('moves both lines to the prices of the new tier, prorating only the fixed fee', async () => {
      const calls = stubStripe([
        (call) => (call.method === 'POST' ? { status: 200, body: { id: 'si' } } : undefined),
      ]);

      await buildGateway().changeVoiceAddonTier({
        itemId: 'si_fee',
        overageItemId: 'si_minutes',
        monthlyPriceId: 'price_pro_fee',
        overagePriceId: 'price_pro_minutes',
      });

      expect(calls.map((call) => [call.path, Object.fromEntries(call.form)])).toEqual([
        [
          '/subscription_items/si_fee',
          { price: 'price_pro_fee', proration_behavior: 'create_prorations' },
        ],
        [
          '/subscription_items/si_minutes',
          { price: 'price_pro_minutes', proration_behavior: 'none' },
        ],
      ]);
    });
  });

  describe('detachVoiceAddon', () => {
    it('removes both lines and clears the usage of the metered one', async () => {
      const calls = stubStripe([
        (call) => (call.method === 'DELETE' ? { status: 200, body: { id: 'si' } } : undefined),
      ]);

      await buildGateway().detachVoiceAddon({ itemId: 'si_fee', overageItemId: 'si_minutes' });

      expect(calls.map((call) => call.path)).toEqual([
        '/subscription_items/si_fee',
        '/subscription_items/si_minutes?proration_behavior=none&clear_usage=true',
      ]);
    });

    it('is not a failure when the lines are already gone', async () => {
      stubStripe([]);

      await expect(
        buildGateway().detachVoiceAddon({ itemId: 'si_fee', overageItemId: 'si_minutes' }),
      ).resolves.toBeUndefined();
    });
  });

  describe('reportVoiceOverage', () => {
    it('sends the minutes to the meter with an identifier, the customer and the instant of the call', async () => {
      const calls = stubStripe([
        (call) => (call.method === 'POST' ? { status: 200, body: { identifier: 'x' } } : undefined),
      ]);

      await buildGateway().reportVoiceOverage({
        customerId: 'cus_1',
        minutes: 7,
        identifier: 'yoclick-voice-overage-call-1',
        occurredAt: new Date('2026-10-28T10:00:00.000Z'),
      });

      const [call] = calls;
      expect(call?.path).toBe('/billing/meter_events');
      expect(Object.fromEntries(call?.form ?? [])).toEqual({
        event_name: 'yoclick_voice_minutes',
        identifier: 'yoclick-voice-overage-call-1',
        'payload[stripe_customer_id]': 'cus_1',
        'payload[value]': '7',
        timestamp: String(Date.parse('2026-10-28T10:00:00.000Z') / 1000),
      });
      expect(call?.idempotencyKey).toBe('yoclick-voice-overage-call-1');
    });

    it('fails when Stripe fails, so the call stays pending and is retried', async () => {
      stubStripe([
        (call) =>
          call.method === 'POST'
            ? { status: 500, body: { error: { code: 'api_error', message: 'down' } } }
            : undefined,
      ]);

      await expect(
        buildGateway().reportVoiceOverage({
          customerId: 'cus_1',
          minutes: 1,
          identifier: 'id',
          occurredAt: new Date(),
        }),
      ).rejects.toThrow(/failed with status 500/);
    });
  });

  describe('createCheckoutSession with the add-on as an optional item', () => {
    const request = {
      customerId: 'cus_1',
      centerId: '0198f4a0-0000-7000-8000-000000000001',
      planId: 'pro',
      period: 'monthly',
      priceId: 'price_plan_monthly',
      setupFeePriceId: null,
      taxRateId: 'txr_1',
      firstChargeAt: null,
      voiceAddonPriceId: 'price_voice_fee',
    } as const;
    const answerSession = (call: RecordedCall) =>
      call.method === 'POST' && call.path === '/checkout/sessions'
        ? { status: 200, body: { url: 'https://checkout.stripe.test/s1' } }
        : undefined;

    it('offers the monthly fee of the add-on as an optional item, with the VAT, on a pinned API version', async () => {
      const calls = stubStripe([answerSession]);

      await buildGateway().createCheckoutSession(request);

      const [session] = bodyOf(calls, 'POST', '/checkout/sessions');
      expect(Object.fromEntries(session?.form ?? [])).toMatchObject({
        'line_items[0][price]': 'price_plan_monthly',
        'optional_items[0][price]': 'price_voice_fee',
        'optional_items[0][quantity]': '1',
        'subscription_data[default_tax_rates][0]': 'txr_1',
      });
      expect(session?.stripeVersion).toBe('2025-03-31.basil');
    });

    it('leaves the checkout as it was, on the account API version, when there is nothing to offer', async () => {
      const calls = stubStripe([answerSession]);

      await buildGateway().createCheckoutSession({ ...request, voiceAddonPriceId: null });

      const [session] = bodyOf(calls, 'POST', '/checkout/sessions');
      const fields = Object.fromEntries(session?.form ?? []);
      expect(Object.keys(fields).some((name) => name.startsWith('optional_items'))).toBe(false);
      expect(fields).not.toHaveProperty('subscription_data[default_tax_rates][0]');
      expect(session?.stripeVersion).toBeNull();
    });
  });

  describe('hasVoiceAddonLine', () => {
    const subscriptionWith = (items: unknown[]) => (call: RecordedCall) =>
      call.method === 'GET' && call.path === '/subscriptions/sub_1'
        ? { status: 200, body: { id: 'sub_1', items: { data: items } } }
        : undefined;

    it('is true when the subscription carries the fixed line of the add-on', async () => {
      stubStripe([
        subscriptionWith([
          {
            id: 'si_fee',
            price: { id: 'price_fee', product: 'yoclick_voice_addon', recurring: {} },
          },
        ]),
      ]);

      expect(await buildGateway().hasVoiceAddonLine('sub_1')).toBe(true);
    });

    it('is false when only the plan is there, or only the metered line', async () => {
      stubStripe([
        subscriptionWith([
          { id: 'si_plan', price: { id: 'p', product: 'yoclick_plan_pro', recurring: {} } },
          {
            id: 'si_minutes',
            price: {
              id: 'm',
              product: 'yoclick_voice_addon',
              recurring: { usage_type: 'metered' },
            },
          },
        ]),
      ]);

      expect(await buildGateway().hasVoiceAddonLine('sub_1')).toBe(false);
    });
  });
});
