import { mergeCallOutcomes } from './call-outcome';

describe('mergeCallOutcomes', () => {
  it.each([
    { current: null, incoming: 'no_action', expected: 'no_action' },
    { current: 'no_action', incoming: 'booking', expected: 'booking' },
    { current: 'booking', incoming: 'transfer', expected: 'booking' },
    { current: 'cancellation', incoming: 'reschedule', expected: 'reschedule' },
    { current: 'waitlist', incoming: 'transfer', expected: 'waitlist' },
  ] as const)(
    'keeps the most relevant of $current and $incoming',
    ({ current, incoming, expected }) => {
      expect(mergeCallOutcomes(current, incoming)).toBe(expected);
    },
  );
});
