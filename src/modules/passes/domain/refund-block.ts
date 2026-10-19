export interface RefundBlockFacts {
  readonly bookingCreatedAt: Date;
  readonly bookingStatus: string;
  readonly bookingSource: 'single' | 'enrollment';
  /** Tiene un bono activo, no caducado y con saldo. */
  readonly hasValidPass: boolean;
  /** Cuándo se anularon sus bonos reembolsados por completo. */
  readonly refundedPassCancelledAt: readonly Date[];
}

/**
 * Una cita pendiente queda bloqueada si se hizo antes de que le reembolsaran un bono entero y la
 * persona aún no tiene otro válido: la cita no se anula, pero no se puede atender hasta que compre
 * y use un bono nuevo. Las citas hechas después del reembolso son clases sueltas y no se bloquean;
 * las de matrícula en un grupo fijo no gastan bono.
 */
export function isBookingBlockedByRefund(facts: RefundBlockFacts): boolean {
  if (facts.bookingStatus !== 'confirmed' || facts.bookingSource !== 'single') return false;
  if (facts.hasValidPass) return false;
  return facts.refundedPassCancelledAt.some(
    (cancelledAt) => cancelledAt.getTime() >= facts.bookingCreatedAt.getTime(),
  );
}
