import {
  applyPlanPriceChanges,
  arePlanPricesValid,
  computeMonthlyRecurringRevenueCents,
  describePlanPriceChanges,
} from './plan-rules';

const CURRENT = { monthlyPriceCents: 7900, annualMonthlyPriceCents: 6500, setupFeeCents: 0 };

describe('arePlanPricesValid', () => {
  it.each([
    ['the current prices', CURRENT, true],
    ['free plan', { monthlyPriceCents: 0, annualMonthlyPriceCents: 0, setupFeeCents: 0 }, true],
    ['annual equal to monthly', { ...CURRENT, annualMonthlyPriceCents: 7900 }, true],
    ['annual above monthly', { ...CURRENT, annualMonthlyPriceCents: 8000 }, false],
    ['negative monthly', { ...CURRENT, monthlyPriceCents: -1 }, false],
    ['negative setup fee', { ...CURRENT, setupFeeCents: -100 }, false],
    ['fractional cents', { ...CURRENT, monthlyPriceCents: 79.5 }, false],
    ['absurdly high', { ...CURRENT, monthlyPriceCents: 1_000_001 }, false],
  ])('%s -> %s', (_caseName, prices, isValid) => {
    expect(arePlanPricesValid(prices)).toBe(isValid);
  });
});

describe('applyPlanPriceChanges', () => {
  it('keeps what was not sent', () => {
    expect(applyPlanPriceChanges(CURRENT, { monthlyPriceCents: 8900 })).toEqual({
      ...CURRENT,
      monthlyPriceCents: 8900,
    });
  });
});

describe('describePlanPriceChanges', () => {
  it('leaves one trace per price that really changes', () => {
    expect(
      describePlanPriceChanges('pro', CURRENT, { monthlyPriceCents: 8900, setupFeeCents: 0 }),
    ).toEqual([
      {
        action: 'plan_price_changed',
        details: { planId: 'pro', field: 'monthlyPriceCents', from: 7900, to: 8900 },
      },
    ]);
  });

  it('records nothing when nothing changes', () => {
    expect(describePlanPriceChanges('pro', CURRENT, {})).toEqual([]);
  });
});

describe('computeMonthlyRecurringRevenueCents', () => {
  it('adds the monthly price of each plan times its paying centers', () => {
    expect(
      computeMonthlyRecurringRevenueCents([
        { monthlyPriceCents: 3900, payingCenterCount: 2 },
        { monthlyPriceCents: 7900, payingCenterCount: 1 },
        { monthlyPriceCents: 14900, payingCenterCount: 0 },
      ]),
    ).toBe(15700);
  });

  it('is zero with no paying centers', () => {
    expect(computeMonthlyRecurringRevenueCents([])).toBe(0);
  });
});
