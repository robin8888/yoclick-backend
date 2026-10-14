import { resolvePassStatus, type StoredPassState } from './pass-rules';

/** Por qué una persona puede o no puede entrar al centro con su bono. */
export type PassAccessReason =
  | 'valid_pass'
  | 'passes_not_required'
  | 'no_pass'
  | 'pass_pending'
  | 'pass_expired'
  | 'pass_exhausted';

export interface AccessPass extends StoredPassState {
  readonly name: string;
  readonly totalSessions: number;
}

export interface PassAccessDecision {
  readonly isGranted: boolean;
  readonly reason: PassAccessReason;
  /** El bono que explica la decisión; `null` si no hay ninguno que la explique. */
  readonly pass: AccessPass | null;
}

const NEVER_EXPIRES = Number.MAX_SAFE_INTEGER;

function expiryTime(pass: AccessPass): number {
  return pass.expiresAt?.getTime() ?? NEVER_EXPIRES;
}

/** El que antes caduca; a igual caducidad, el de más saldo. Así no se deja perder ninguno. */
function pickSoonestToExpire(passes: readonly AccessPass[]): AccessPass | null {
  const sorted = [...passes].sort(
    (left, right) =>
      expiryTime(left) - expiryTime(right) || right.remainingSessions - left.remainingSessions,
  );
  return sorted[0] ?? null;
}

/** El más reciente: el que explica mejor por qué ya no sirve. */
function pickLatestToExpire(passes: readonly AccessPass[]): AccessPass | null {
  const sorted = [...passes].sort((left, right) => expiryTime(right) - expiryTime(left));
  return sorted[0] ?? null;
}

const DENIAL_PRIORITY = [
  ['expired', 'pass_expired'],
  ['exhausted', 'pass_exhausted'],
  ['pending', 'pass_pending'],
] as const;

/**
 * Si una persona puede entrar: necesita un bono guardado como activo, que no haya caducado en este
 * instante (caduca justo en `expiresAt`) y con saldo. Los rechazados y cancelados no cuentan. Un
 * centro sin tarifas no usa bonos y no controla el acceso.
 */
export function decidePassAccess(input: {
  passes: readonly AccessPass[];
  hasRates: boolean;
  now: Date;
}): PassAccessDecision {
  if (!input.hasRates) return { isGranted: true, reason: 'passes_not_required', pass: null };

  const byStatus = (status: string): AccessPass[] =>
    input.passes.filter((pass) => resolvePassStatus(pass, input.now) === status);

  const valid = pickSoonestToExpire(byStatus('active'));
  if (valid) return { isGranted: true, reason: 'valid_pass', pass: valid };

  for (const [status, reason] of DENIAL_PRIORITY) {
    const explaining = pickLatestToExpire(byStatus(status));
    if (explaining) return { isGranted: false, reason, pass: explaining };
  }
  return { isGranted: false, reason: 'no_pass', pass: null };
}
