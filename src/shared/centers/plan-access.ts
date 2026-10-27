/** Lo que hace falta saber de un centro para decidir si su plan le deja trabajar. */
export interface PlanAccessFacts {
  readonly status: 'trial' | 'active' | 'past_due' | 'suspended';
  readonly trialEndsAt: Date | null;
  readonly graceEndsAt: Date | null;
  readonly hasSubscription: boolean;
}

/**
 * El centro debe contratar un plan para seguir gestionándose: la prueba acabó sin plan, la gracia
 * tras un impago se agotó o fue suspendido. No depende del barrido diario: se calcula con las
 * fechas, así que el aviso llega el mismo día en que acaba la prueba.
 */
export function isPlanRequired(facts: PlanAccessFacts, now: Date): boolean {
  if (facts.status === 'suspended') return true;
  if (facts.status === 'past_due') {
    return facts.graceEndsAt !== null && facts.graceEndsAt.getTime() <= now.getTime();
  }
  return (
    facts.status === 'trial' &&
    !facts.hasSubscription &&
    facts.trialEndsAt !== null &&
    facts.trialEndsAt.getTime() <= now.getTime()
  );
}
