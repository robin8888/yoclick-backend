import { resolveVoiceCapabilities } from './voice-capabilities';

describe('resolveVoiceCapabilities', () => {
  it('gives the basic plan only the common abilities', () => {
    expect(resolveVoiceCapabilities('basic')).toEqual({
      canJoinWaitlist: false,
      canBookGroupSessions: false,
      canBookForChildren: false,
      canCustomizeAssistant: false,
      canSendPaymentLink: false,
    });
  });

  it('adds waitlist, groups and families in Pro', () => {
    expect(resolveVoiceCapabilities('pro')).toEqual({
      canJoinWaitlist: true,
      canBookGroupSessions: true,
      canBookForChildren: true,
      canCustomizeAssistant: false,
      canSendPaymentLink: false,
    });
  });

  it('adds the custom assistant and the payment link in Premium', () => {
    expect(resolveVoiceCapabilities('premium')).toEqual({
      canJoinWaitlist: true,
      canBookGroupSessions: true,
      canBookForChildren: true,
      canCustomizeAssistant: true,
      canSendPaymentLink: true,
    });
  });

  it('opens nothing extra for an unknown plan', () => {
    expect(Object.values(resolveVoiceCapabilities('legacy')).some(Boolean)).toBe(false);
  });
});
