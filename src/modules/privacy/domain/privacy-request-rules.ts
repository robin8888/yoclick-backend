export const PRIVACY_REQUEST_KINDS = ['access', 'rectification', 'erasure', 'objection'] as const;
export type PrivacyRequestKindName = (typeof PRIVACY_REQUEST_KINDS)[number];

export const PRIVACY_REQUEST_OUTCOMES = ['completed', 'rejected'] as const;
export type PrivacyRequestOutcome = (typeof PRIVACY_REQUEST_OUTCOMES)[number];

export const MAX_PRIVACY_MESSAGE_LENGTH = 500;
export const MAX_RESOLUTION_NOTE_LENGTH = 500;

/**
 * El centro responde como mucho en un mes desde que recibe la solicitud (RGPD art. 12.3): el mismo día
 * del mes siguiente, o el último día si ese mes es más corto (31 de enero → 28 o 29 de febrero).
 */
export function calculatePrivacyRequestDueDate(receivedAt: Date): Date {
  const dueDate = new Date(receivedAt.getTime());
  const dayOfMonth = dueDate.getUTCDate();
  dueDate.setUTCDate(1);
  dueDate.setUTCMonth(dueDate.getUTCMonth() + 1);
  const lastDayOfDueMonth = new Date(
    Date.UTC(dueDate.getUTCFullYear(), dueDate.getUTCMonth() + 1, 0),
  ).getUTCDate();
  dueDate.setUTCDate(Math.min(dayOfMonth, lastDayOfDueMonth));
  return dueDate;
}

/** Una solicitud sin responder cuyo plazo ya pasó. */
export function isPrivacyRequestOverdue(
  request: { readonly status: string; readonly dueAt: Date },
  now: Date,
): boolean {
  return request.status === 'open' && request.dueAt.getTime() < now.getTime();
}
