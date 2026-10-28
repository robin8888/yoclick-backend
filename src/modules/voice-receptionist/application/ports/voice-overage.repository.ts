export const VOICE_OVERAGE_REPOSITORY = Symbol('VOICE_OVERAGE_REPOSITORY');

/** El exceso de minutos de una llamada que todavía hay que comunicar a Stripe. */
export interface ReportableVoiceOverage {
  readonly callLogId: string;
  readonly centerId: string;
  /** El cliente de Stripe del centro: sin él no hay a quién cobrar. */
  readonly stripeCustomerId: string;
  readonly minutes: number;
  /** Cuándo acabó la llamada: a ese instante se atribuye el consumo en el periodo de cobro. */
  readonly endedAt: Date;
}

/**
 * Los excesos pendientes se leen con el contexto de facturación (no hay centro ni sesión): solo se ven los de
 * centros con cliente de Stripe y línea de uso medido, y solo se puede marcar uno como comunicado.
 */
export interface VoiceOverageRepository {
  findReportableCall(callLogId: string, now: Date): Promise<ReportableVoiceOverage | null>;
  listReportableCalls(now: Date, limit: number): Promise<ReportableVoiceOverage[]>;
  /** `false` si otra vuelta ya lo había marcado. */
  markReported(callLogId: string, reportedAt: Date): Promise<boolean>;
}
