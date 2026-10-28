export const VOICE_CALL_OUTCOMES = [
  'booking',
  'cancellation',
  'reschedule',
  'transfer',
  'no_action',
  'waitlist',
] as const;

export type VoiceCallOutcomeName = (typeof VOICE_CALL_OUTCOMES)[number];

/** Una llamada puede hacer varias cosas; en el historial se enseña la que más importa al centro. */
const OUTCOME_PRIORITY: Readonly<Record<VoiceCallOutcomeName, number>> = {
  booking: 5,
  reschedule: 4,
  cancellation: 3,
  waitlist: 2,
  transfer: 1,
  no_action: 0,
};

export function mergeCallOutcomes(
  current: VoiceCallOutcomeName | null,
  incoming: VoiceCallOutcomeName,
): VoiceCallOutcomeName {
  if (current === null) return incoming;
  return OUTCOME_PRIORITY[incoming] > OUTCOME_PRIORITY[current] ? incoming : current;
}
