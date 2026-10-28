import { FakeBillingGateway } from '../infrastructure/fake-billing-gateway';
import { type BillingEvent } from './ports/billing-gateway';
import {
  type BillingCenter,
  type BillingTransaction,
  type BillingVoiceSubscription,
  type BillingVoiceSubscriptionChanges,
  type NewBillingVoiceSubscription,
  type VoiceAddonTier,
} from './ports/billing.repository';
import {
  activateVoiceAddonChosenAtCheckout,
  syncVoiceAddonWithSubscription,
} from './voice-addon-sync';

const CENTER_ID = '0198f4a0-0000-7000-8000-000000000001';
const PERIOD_START = new Date('2026-10-15T09:00:00.000Z');
const PERIOD_END = new Date('2026-11-15T09:00:00.000Z');

type SubscriptionChangedEvent = Extract<BillingEvent, { type: 'subscription_changed' }>;

const CENTER: BillingCenter = {
  id: CENTER_ID,
  name: 'Studio Norte',
  status: 'active',
  planId: 'basic',
  trialEndsAt: null,
  graceEndsAt: null,
  stripeCustomerId: 'cus_1',
  stripeSubscriptionId: 'sub_1',
};

const TIERS: Record<string, VoiceAddonTier> = {
  basic: {
    planId: 'basic',
    includedMinutes: 150,
    monthlyPriceId: 'price_basic_fee',
    overagePriceId: 'price_basic_minutes',
  },
  pro: {
    planId: 'pro',
    includedMinutes: 250,
    monthlyPriceId: 'price_pro_fee',
    overagePriceId: 'price_pro_minutes',
  },
};

/** Una transacción en memoria con solo lo que usa la sincronización del add-on. */
class VoiceTransaction {
  subscription: BillingVoiceSubscription | null = {
    status: 'active',
    includedMinutes: 150,
    periodStart: PERIOD_START,
    periodEnd: PERIOD_END,
    stripeItemId: 'si_fee',
    stripeOverageItemId: 'si_minutes',
  };
  updates: BillingVoiceSubscriptionChanges[] = [];
  chosenSubscriptions: NewBillingVoiceSubscription[] = [];
  centerChanges: object[] = [];
  audit: string[] = [];

  asTransaction(): BillingTransaction {
    return {
      findVoiceSubscription: () => Promise.resolve(this.subscription),
      updateVoiceSubscription: (_centerId: string, changes: BillingVoiceSubscriptionChanges) => {
        this.updates.push(changes);
        return Promise.resolve();
      },
      findVoiceAddonTier: (planId: string) => Promise.resolve(TIERS[planId] ?? null),
      findPlanTaxRateId: () => Promise.resolve('txr_1'),
      saveChosenVoiceSubscription: (
        _centerId: string,
        subscription: NewBillingVoiceSubscription,
      ) => {
        this.chosenSubscriptions.push(subscription);
        return Promise.resolve();
      },
      updateCenter: (_centerId: string, changes: object) => {
        this.centerChanges.push(changes);
        return Promise.resolve();
      },
      writeAudit: (entry: { action: string }) => {
        this.audit.push(entry.action);
        return Promise.resolve();
      },
    } as unknown as BillingTransaction;
  }
}

function buildEvent(overrides: Partial<SubscriptionChangedEvent> = {}): SubscriptionChangedEvent {
  return {
    type: 'subscription_changed',
    eventId: 'evt_1',
    customerId: 'cus_1',
    subscriptionId: 'sub_1',
    status: 'active',
    planId: 'basic',
    period: 'monthly',
    voiceAddon: { isPresent: true, periodStart: PERIOD_START, periodEnd: PERIOD_END },
    ...overrides,
  };
}

describe('syncVoiceAddonWithSubscription', () => {
  let transaction: VoiceTransaction;
  let gateway: FakeBillingGateway;

  const run = (event: SubscriptionChangedEvent) =>
    syncVoiceAddonWithSubscription({
      transaction: transaction.asTransaction(),
      gateway,
      centerBeforeEvent: CENTER,
      event,
    });

  beforeEach(() => {
    transaction = new VoiceTransaction();
    gateway = new FakeBillingGateway();
  });

  it('does nothing for a center that never contracted the add-on', async () => {
    transaction.subscription = null;

    await run(buildEvent({ status: 'canceled' }));

    expect(transaction.updates).toEqual([]);
    expect(gateway.voiceTierChanges).toEqual([]);
  });

  it('does nothing when nothing about the add-on changed', async () => {
    await run(buildEvent());

    expect(transaction.updates).toEqual([]);
    expect(transaction.audit).toEqual([]);
  });

  it('pauses the add-on when the payment fails, without switching the center off', async () => {
    await run(buildEvent({ status: 'past_due' }));

    expect(transaction.updates).toEqual([{ status: 'paused' }]);
    expect(transaction.centerChanges).toEqual([]);
    expect(transaction.audit).toEqual(['voice_addon_status_changed']);
  });

  it('brings it back when the payment is fixed', async () => {
    transaction.subscription = {
      ...(transaction.subscription as BillingVoiceSubscription),
      status: 'paused',
    };

    await run(buildEvent({ status: 'active' }));

    expect(transaction.updates).toEqual([{ status: 'active' }]);
  });

  it.each([
    { name: 'the subscription is canceled', event: { status: 'canceled' as const } },
    {
      name: 'the add-on lines left the subscription',
      event: { voiceAddon: { isPresent: false, periodStart: null, periodEnd: null } },
    },
  ])('cancels the add-on and switches the center off when $name', async ({ event }) => {
    await run(buildEvent(event));

    expect(transaction.updates).toEqual([{ status: 'cancelled' }]);
    expect(transaction.centerChanges).toEqual([{ isVoiceReceptionistEnabled: false }]);
  });

  it('does not touch a plan change of a cancelled add-on', async () => {
    transaction.subscription = {
      ...(transaction.subscription as BillingVoiceSubscription),
      status: 'cancelled',
    };

    await run(buildEvent({ planId: 'pro', status: 'canceled' }));

    expect(gateway.voiceTierChanges).toEqual([]);
    expect(transaction.updates).toEqual([]);
  });

  it('follows the billing period of the subscription, so the minutes are counted in its cycle', async () => {
    const nextStart = new Date('2026-11-15T09:00:00.000Z');
    const nextEnd = new Date('2026-12-15T09:00:00.000Z');

    await run(
      buildEvent({ voiceAddon: { isPresent: true, periodStart: nextStart, periodEnd: nextEnd } }),
    );

    expect(transaction.updates).toEqual([{ periodStart: nextStart, periodEnd: nextEnd }]);
  });

  it('keeps the period when the notice does not carry one', async () => {
    await run(buildEvent({ voiceAddon: { isPresent: true, periodStart: null, periodEnd: null } }));

    expect(transaction.updates).toEqual([]);
  });

  it('moves the add-on to the tier of the new plan: minutes included and prices in Stripe', async () => {
    await run(buildEvent({ planId: 'pro' }));

    expect(transaction.updates).toEqual([{ includedMinutes: 250 }]);
    expect(gateway.voiceTierChanges).toEqual([
      { itemId: 'si_fee', monthlyPriceId: 'price_pro_fee' },
    ]);
    expect(transaction.audit).toEqual(['voice_addon_tier_changed']);
  });

  it('does not reprice when the plan did not change', async () => {
    await run(buildEvent({ planId: 'basic' }));

    expect(gateway.voiceTierChanges).toEqual([]);
  });

  it('updates the minutes but cannot reprice a pilot center that has no lines in Stripe', async () => {
    transaction.subscription = {
      ...(transaction.subscription as BillingVoiceSubscription),
      stripeItemId: null,
      stripeOverageItemId: null,
    };

    await run(buildEvent({ planId: 'pro' }));

    expect(transaction.updates).toEqual([{ includedMinutes: 250 }]);
    expect(gateway.voiceTierChanges).toEqual([]);
  });

  it('fails when Stripe does not accept the change, so the whole notice is retried', async () => {
    gateway.changeVoiceAddonTier = () => Promise.reject(new Error('Stripe is down'));

    await expect(run(buildEvent({ planId: 'pro' }))).rejects.toThrow('Stripe is down');
    expect(transaction.updates).toEqual([]);
  });
});

describe('activateVoiceAddonChosenAtCheckout', () => {
  const CHECKOUT_EVENT = {
    type: 'checkout_completed',
    eventId: 'evt_checkout',
    centerId: CENTER_ID,
    planId: 'pro',
    period: 'monthly',
    customerId: 'cus_1',
    subscriptionId: 'sub_1',
  } as const;

  let transaction: VoiceTransaction;
  let gateway: FakeBillingGateway;

  beforeEach(() => {
    transaction = new VoiceTransaction();
    gateway = new FakeBillingGateway();
  });

  const activate = (event: Parameters<typeof activateVoiceAddonChosenAtCheckout>[1]) =>
    activateVoiceAddonChosenAtCheckout(
      { transaction: transaction.asTransaction(), gateway },
      event,
    );

  it('adds the metered line and signs the center up with the minutes of its plan when the add-on was chosen', async () => {
    gateway.subscriptionIdsWithVoiceAddonLine.add('sub_1');

    await activate(CHECKOUT_EVENT);

    expect(gateway.attachedVoiceSubscriptionIds).toEqual(['sub_1']);
    expect(transaction.chosenSubscriptions).toEqual([
      expect.objectContaining({ includedMinutes: 250, stripeItemId: 'si_fake_voice_sub_1' }),
    ]);
    expect(transaction.audit).toEqual(['voice_addon_chosen_at_checkout']);
  });

  it('does nothing when the plan was bought without the add-on', async () => {
    await activate(CHECKOUT_EVENT);

    expect(gateway.attachedVoiceSubscriptionIds).toEqual([]);
    expect(transaction.chosenSubscriptions).toEqual([]);
    expect(transaction.audit).toEqual([]);
  });

  it('never offers or completes the add-on for a plan paid by the year', async () => {
    gateway.subscriptionIdsWithVoiceAddonLine.add('sub_1');

    await activate({ ...CHECKOUT_EVENT, period: 'annual' });

    expect(gateway.attachedVoiceSubscriptionIds).toEqual([]);
    expect(transaction.chosenSubscriptions).toEqual([]);
  });

  it('does nothing when the tier has no Stripe prices yet', async () => {
    gateway.subscriptionIdsWithVoiceAddonLine.add('sub_1');

    await activate({ ...CHECKOUT_EVENT, planId: 'premium' });

    expect(transaction.chosenSubscriptions).toEqual([]);
  });
});
