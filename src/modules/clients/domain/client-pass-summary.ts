import { resolvePassStatus, type StoredPassState } from '../../passes/domain/pass-rules';

/** Sin bono, pidiéndolo, con bono vigente o con bonos que ya no valen (agotados o caducados). */
export type ClientPassState = 'none' | 'pending' | 'active' | 'ended';

export interface ClientPassSummary {
  readonly state: ClientPassState;
  /** Clases que le quedan entre sus bonos vigentes; `null` si no tiene ninguno vigente. */
  readonly remainingSessions: number | null;
  /** Cuándo caduca el primero de sus bonos vigentes; `null` si ninguno caduca o no hay vigentes. */
  readonly expiresAt: Date | null;
}

export const NO_PASS_SUMMARY: ClientPassSummary = {
  state: 'none',
  remainingSessions: null,
  expiresAt: null,
};

function earliestExpiry(passes: readonly StoredPassState[]): Date | null {
  const expiries = passes.flatMap((pass) => (pass.expiresAt === null ? [] : [pass.expiresAt]));
  if (expiries.length === 0) return null;
  return new Date(Math.min(...expiries.map((expiry) => expiry.getTime())));
}

/**
 * Lo que el centro necesita ver de un vistazo en la lista de personas. Un bono vigente manda sobre uno
 * pedido, y este sobre los terminados; los rechazados y los quitados por el centro no cuentan.
 */
export function resolveClientPassSummary(
  passes: readonly StoredPassState[],
  now: Date,
): ClientPassSummary {
  const statusOf = (pass: StoredPassState) => resolvePassStatus(pass, now);
  const activePasses = passes.filter((pass) => statusOf(pass) === 'active');
  if (activePasses.length > 0) {
    return {
      state: 'active',
      remainingSessions: activePasses.reduce((sum, pass) => sum + pass.remainingSessions, 0),
      expiresAt: earliestExpiry(activePasses),
    };
  }
  if (passes.some((pass) => statusOf(pass) === 'pending')) {
    return { ...NO_PASS_SUMMARY, state: 'pending' };
  }
  const hasEndedPass = passes.some((pass) => ['exhausted', 'expired'].includes(statusOf(pass)));
  return hasEndedPass ? { ...NO_PASS_SUMMARY, state: 'ended' } : NO_PASS_SUMMARY;
}
