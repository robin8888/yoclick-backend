import { parseBillingEvent } from './stripe-billing-events';

const CENTER_ID = '0198a8a0-0000-7000-8000-000000000001';

function buildEvent(type: string, object: Record<string, unknown>, extra = {}): string {
  return JSON.stringify({ id: 'evt_1', type, data: { object }, ...extra });
}

describe('parseBillingEvent', () => {
  it('reads a completed checkout with the center, plan and period it was started for', () => {
    const event = parseBillingEvent(
      buildEvent('checkout.session.completed', {
        customer: 'cus_1',
        subscription: 'sub_1',
        metadata: { centerId: CENTER_ID, planId: 'pro', period: 'annual' },
      }),
    );

    expect(event).toEqual({
      type: 'checkout_completed',
      eventId: 'evt_1',
      centerId: CENTER_ID,
      planId: 'pro',
      period: 'annual',
      customerId: 'cus_1',
      subscriptionId: 'sub_1',
    });
  });

  it('ignores a checkout that does not carry our metadata', () => {
    const event = parseBillingEvent(
      buildEvent('checkout.session.completed', {
        customer: 'cus_1',
        subscription: 'sub_1',
        metadata: {},
      }),
    );

    expect(event).toBeNull();
  });

  it.each(['active', 'past_due', 'unpaid', 'trialing'])(
    'reads a subscription update to %s',
    (status) => {
      const event = parseBillingEvent(
        buildEvent('customer.subscription.updated', { id: 'sub_1', customer: 'cus_1', status }),
      );

      expect(event).toMatchObject({ type: 'subscription_changed', customerId: 'cus_1', status });
    },
  );

  it.each([
    { product: 'yoclick_plan_basic', interval: 'month', planId: 'basic', period: 'monthly' },
    { product: 'yoclick_plan_premium', interval: 'year', planId: 'premium', period: 'annual' },
  ])(
    'reads the plan $planId and the $period period from the subscription items',
    ({ product, interval, planId, period }) => {
      const event = parseBillingEvent(
        buildEvent('customer.subscription.updated', {
          id: 'sub_1',
          customer: 'cus_1',
          status: 'active',
          items: { data: [{ price: { product, recurring: { interval } } }] },
        }),
      );

      expect(event).toMatchObject({ planId, period });
    },
  );

  it.each([
    { name: 'there are no items', items: undefined },
    { name: 'the product is not one of ours', items: { data: [{ price: { product: 'prod_x' } }] } },
    { name: 'the plan is unknown', items: { data: [{ price: { product: 'yoclick_plan_gold' } }] } },
  ])('does not guess the plan when $name', ({ items }) => {
    const event = parseBillingEvent(
      buildEvent('customer.subscription.updated', {
        id: 'sub_1',
        customer: 'cus_1',
        status: 'active',
        ...(items === undefined ? {} : { items }),
      }),
    );

    expect(event).toMatchObject({ planId: null, period: null });
  });

  it('treats a deleted subscription as canceled whatever status it carries', () => {
    const event = parseBillingEvent(
      buildEvent('customer.subscription.deleted', {
        id: 'sub_1',
        customer: 'cus_1',
        status: 'active',
      }),
    );

    expect(event).toMatchObject({ type: 'subscription_changed', status: 'canceled' });
  });

  it('splits a paid invoice into base, VAT and total', () => {
    const event = parseBillingEvent(
      buildEvent('invoice.paid', {
        id: 'in_1',
        customer: 'cus_1',
        number: 'ABCD-0001',
        total: 9559,
        subtotal: 7900,
        total_excluding_tax: 7900,
        description: 'Plan Pro',
        created: 1_760_000_000,
        status_transitions: { paid_at: 1_760_000_100 },
      }),
    );

    expect(event).toMatchObject({
      type: 'invoice_paid',
      invoiceId: 'in_1',
      baseCents: 7900,
      vatCents: 1659,
      totalCents: 9559,
      invoiceNumber: 'ABCD-0001',
    });
    expect(event?.type === 'invoice_paid' && event.paidAt.toISOString()).toBe(
      '2025-10-09T08:55:00.000Z',
    );
  });

  it('has no VAT when the invoice has none', () => {
    const event = parseBillingEvent(
      buildEvent('invoice.paid', {
        id: 'in_1',
        customer: 'cus_1',
        total: 7900,
        subtotal: 7900,
        created: 1_760_000_000,
      }),
    );

    expect(event).toMatchObject({ baseCents: 7900, vatCents: 0, totalCents: 7900 });
  });

  it('reads a failed payment', () => {
    expect(parseBillingEvent(buildEvent('invoice.payment_failed', { customer: 'cus_1' }))).toEqual({
      type: 'payment_failed',
      eventId: 'evt_1',
      customerId: 'cus_1',
    });
  });

  it.each(['payment_intent.succeeded', 'charge.refunded', 'customer.created'])(
    'ignores %s, which is not about the plan',
    (type) => {
      expect(parseBillingEvent(buildEvent(type, { id: 'x', customer: 'cus_1' }))).toBeNull();
    },
  );

  it('ignores any event of a connected account (a center charging its clients)', () => {
    const event = parseBillingEvent(
      buildEvent(
        'invoice.paid',
        { id: 'in_1', customer: 'cus_1', total: 100, subtotal: 100, created: 1 },
        { account: 'acct_1' },
      ),
    );

    expect(event).toBeNull();
  });
});
