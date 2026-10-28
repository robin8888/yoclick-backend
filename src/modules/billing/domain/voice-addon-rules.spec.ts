import { type SubscriptionStatus } from './subscription-rules';
import { decideVoiceSubscriptionState, type VoiceSubscriptionState } from './voice-addon-rules';

describe('decideVoiceSubscriptionState', () => {
  it.each<{
    name: string;
    current: VoiceSubscriptionState;
    stripeStatus: SubscriptionStatus;
    isAddonPresent: boolean | null;
    expected: VoiceSubscriptionState;
  }>([
    {
      name: 'a healthy subscription keeps it active',
      current: 'active',
      stripeStatus: 'active',
      isAddonPresent: true,
      expected: 'active',
    },
    {
      name: 'a trial counts as healthy',
      current: 'active',
      stripeStatus: 'trialing',
      isAddonPresent: null,
      expected: 'active',
    },
    {
      name: 'a failed payment pauses it',
      current: 'active',
      stripeStatus: 'past_due',
      isAddonPresent: true,
      expected: 'paused',
    },
    {
      name: 'an unpaid subscription pauses it',
      current: 'active',
      stripeStatus: 'unpaid',
      isAddonPresent: null,
      expected: 'paused',
    },
    {
      name: 'a paid invoice brings it back from the pause',
      current: 'paused',
      stripeStatus: 'active',
      isAddonPresent: true,
      expected: 'active',
    },
    {
      name: 'a canceled subscription cancels it',
      current: 'active',
      stripeStatus: 'canceled',
      isAddonPresent: true,
      expected: 'cancelled',
    },
    {
      name: 'the add-on lines leaving the subscription cancel it even if the plan is fine',
      current: 'active',
      stripeStatus: 'active',
      isAddonPresent: false,
      expected: 'cancelled',
    },
    {
      name: 'a cancelled add-on does not come back from an update that says nothing about its lines',
      current: 'cancelled',
      stripeStatus: 'active',
      isAddonPresent: null,
      expected: 'cancelled',
    },
    {
      name: 'a cancelled add-on stays cancelled while the payment fails',
      current: 'cancelled',
      stripeStatus: 'past_due',
      isAddonPresent: null,
      expected: 'cancelled',
    },
    {
      name: 'a re-attached add-on becomes active again',
      current: 'cancelled',
      stripeStatus: 'active',
      isAddonPresent: true,
      expected: 'active',
    },
  ])('$name', ({ current, stripeStatus, isAddonPresent, expected }) => {
    expect(decideVoiceSubscriptionState({ current, stripeStatus, isAddonPresent })).toBe(expected);
  });
});
