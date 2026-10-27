import {
  GRACE_PERIOD_DAYS,
  addGracePeriod,
  applyPaymentFailed,
  applyPaymentSucceeded,
  applySubscriptionStatus,
  isGraceExpired,
  isInvoiceChargeable,
  isTrialExpiredWithoutPlan,
  type CenterBillingState,
  type SubscriptionStatus,
} from './subscription-rules';

const NOW = new Date('2026-10-27T10:00:00.000Z');
const IN_SEVEN_DAYS = new Date('2026-11-03T10:00:00.000Z');
const YESTERDAY = new Date('2026-10-26T10:00:00.000Z');
const TOMORROW = new Date('2026-10-28T10:00:00.000Z');

const TRIAL: CenterBillingState = { status: 'trial', graceEndsAt: null };
const ACTIVE: CenterBillingState = { status: 'active', graceEndsAt: null };
const IN_GRACE: CenterBillingState = { status: 'past_due', graceEndsAt: TOMORROW };
const SUSPENDED: CenterBillingState = { status: 'suspended', graceEndsAt: null };

describe('addGracePeriod', () => {
  it('gives seven days', () => {
    expect(GRACE_PERIOD_DAYS).toBe(7);
    expect(addGracePeriod(NOW)).toEqual(IN_SEVEN_DAYS);
  });
});

describe('applyPaymentSucceeded', () => {
  it.each([
    { name: 'a trial', current: TRIAL },
    { name: 'a center in grace', current: IN_GRACE },
    { name: 'a suspended center', current: SUSPENDED },
  ])('makes $name active and clears the grace', ({ current }) => {
    expect(applyPaymentSucceeded(current)).toEqual(ACTIVE);
  });

  it('changes nothing for an active center', () => {
    expect(applyPaymentSucceeded(ACTIVE)).toBeNull();
  });
});

describe('applyPaymentFailed', () => {
  it.each([
    { name: 'an active center', current: ACTIVE },
    { name: 'a trial', current: TRIAL },
  ])('opens seven days of grace for $name', ({ current }) => {
    expect(applyPaymentFailed(current, NOW)).toEqual({
      status: 'past_due',
      graceEndsAt: IN_SEVEN_DAYS,
    });
  });

  it('does not extend a grace that is already running', () => {
    expect(applyPaymentFailed(IN_GRACE, NOW)).toBeNull();
  });

  it('does not bring a suspended center back to grace', () => {
    expect(applyPaymentFailed(SUSPENDED, NOW)).toBeNull();
  });
});

describe('applySubscriptionStatus', () => {
  it.each([
    { stripeStatus: 'active', current: IN_GRACE, expected: ACTIVE },
    { stripeStatus: 'active', current: ACTIVE, expected: null },
    {
      stripeStatus: 'past_due',
      current: ACTIVE,
      expected: { status: 'past_due', graceEndsAt: IN_SEVEN_DAYS },
    },
    {
      stripeStatus: 'unpaid',
      current: ACTIVE,
      expected: { status: 'past_due', graceEndsAt: IN_SEVEN_DAYS },
    },
    { stripeStatus: 'past_due', current: IN_GRACE, expected: null },
    { stripeStatus: 'canceled', current: ACTIVE, expected: SUSPENDED },
    { stripeStatus: 'canceled', current: IN_GRACE, expected: SUSPENDED },
    { stripeStatus: 'canceled', current: SUSPENDED, expected: null },
    { stripeStatus: 'incomplete_expired', current: TRIAL, expected: SUSPENDED },
    { stripeStatus: 'trialing', current: TRIAL, expected: null },
    { stripeStatus: 'incomplete', current: TRIAL, expected: null },
    { stripeStatus: 'paused', current: ACTIVE, expected: null },
  ] as {
    stripeStatus: SubscriptionStatus;
    current: CenterBillingState;
    expected: CenterBillingState | null;
  }[])(
    'turns Stripe "$stripeStatus" on $current.status into $expected',
    ({ stripeStatus, current, expected }) => {
      expect(applySubscriptionStatus(current, stripeStatus, NOW)).toEqual(expected);
    },
  );
});

describe('isTrialExpiredWithoutPlan', () => {
  it.each([
    {
      name: 'ended and no plan',
      status: 'trial',
      trialEndsAt: YESTERDAY,
      hasSubscription: false,
      isExpired: true,
    },
    {
      name: 'ends right now',
      status: 'trial',
      trialEndsAt: NOW,
      hasSubscription: false,
      isExpired: true,
    },
    {
      name: 'still running',
      status: 'trial',
      trialEndsAt: TOMORROW,
      hasSubscription: false,
      isExpired: false,
    },
    {
      name: 'ended but Stripe will charge',
      status: 'trial',
      trialEndsAt: YESTERDAY,
      hasSubscription: true,
      isExpired: false,
    },
    {
      name: 'has no end date',
      status: 'trial',
      trialEndsAt: null,
      hasSubscription: false,
      isExpired: false,
    },
    {
      name: 'is already active',
      status: 'active',
      trialEndsAt: YESTERDAY,
      hasSubscription: false,
      isExpired: false,
    },
  ] as const)(
    'is $isExpired when the trial $name',
    ({ status, trialEndsAt, hasSubscription, isExpired }) => {
      expect(isTrialExpiredWithoutPlan({ status, trialEndsAt, hasSubscription }, NOW)).toBe(
        isExpired,
      );
    },
  );
});

describe('isGraceExpired', () => {
  it.each([
    { status: 'past_due', graceEndsAt: YESTERDAY, isExpired: true },
    { status: 'past_due', graceEndsAt: NOW, isExpired: true },
    { status: 'past_due', graceEndsAt: TOMORROW, isExpired: false },
    { status: 'past_due', graceEndsAt: null, isExpired: false },
    { status: 'active', graceEndsAt: YESTERDAY, isExpired: false },
    { status: 'suspended', graceEndsAt: YESTERDAY, isExpired: false },
  ] as const)(
    'is $isExpired for $status ending $graceEndsAt',
    ({ status, graceEndsAt, isExpired }) => {
      expect(isGraceExpired({ status, graceEndsAt }, NOW)).toBe(isExpired);
    },
  );
});

describe('isInvoiceChargeable', () => {
  it.each([
    { totalCents: 0, isChargeable: false },
    { totalCents: 1, isChargeable: true },
    { totalCents: 9559, isChargeable: true },
  ])('is $isChargeable for $totalCents cents', ({ totalCents, isChargeable }) => {
    expect(isInvoiceChargeable(totalCents)).toBe(isChargeable);
  });
});
