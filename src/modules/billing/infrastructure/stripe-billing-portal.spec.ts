import { type SyncedPlan } from '../application/ports/billing-gateway';
import { buildPortalFields } from './stripe-billing-gateway';

const PLANS: readonly SyncedPlan[] = [
  {
    planId: 'basic',
    productId: 'prod_basic',
    monthlyPriceId: 'price_basic_month',
    annualPriceId: 'price_basic_year',
    setupFeePriceId: null,
    taxRateId: 'txr_1',
  },
  {
    planId: 'pro',
    productId: 'prod_pro',
    monthlyPriceId: 'price_pro_month',
    annualPriceId: 'price_pro_year',
    setupFeePriceId: null,
    taxRateId: 'txr_1',
  },
];

const RETURN_URL = 'https://yoclick.app/billing/return';

describe('buildPortalFields', () => {
  const fields = buildPortalFields({ plans: PLANS, returnUrl: RETURN_URL });

  it.each([
    [
      'features[subscription_update][schedule_at_period_end][conditions][0][type]',
      'decreasing_item_amount',
    ],
    [
      'features[subscription_update][schedule_at_period_end][conditions][1][type]',
      'shortening_interval',
    ],
  ])('defers the update to the end of the paid period: %s = %s', (field, expected) => {
    expect(fields[field]).toBe(expected);
  });

  it('lets the customer change between our monthly and annual prices of every plan', () => {
    expect(fields['features[subscription_update][products][0][prices][0]']).toBe(
      'price_basic_month',
    );
    expect(fields['features[subscription_update][products][0][prices][1]']).toBe(
      'price_basic_year',
    );
    expect(fields['features[subscription_update][products][1][product]']).toBe('prod_pro');
  });

  it('keeps cancelling at the end of the period and the return address', () => {
    expect(fields['features[subscription_cancel][mode]']).toBe('at_period_end');
    expect(fields['default_return_url']).toBe(RETURN_URL);
  });
});
