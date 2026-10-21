import {
  type AuditEntryInput,
  type CenterChanges,
  type PlatformCenterSummary,
} from '../application/ports/platform.repository';

type CurrentCenter = Pick<PlatformCenterSummary, 'status' | 'trialEndsAt' | 'maxClients'>;

function toIsoOrNull(date: Date | null): string | null {
  return date === null ? null : date.toISOString();
}

/**
 * Qué cambia de verdad y cómo queda en la auditoría. Un valor igual al actual no deja rastro ni
 * toca la base de datos.
 */
export function describeCenterChanges(
  current: CurrentCenter,
  changes: CenterChanges,
): AuditEntryInput[] {
  const entries: AuditEntryInput[] = [];
  if (changes.status !== undefined && changes.status !== current.status) {
    entries.push({
      action: 'center_status_changed',
      details: { from: current.status, to: changes.status },
    });
  }
  if (changes.trialEndsAt !== undefined) {
    const from = toIsoOrNull(current.trialEndsAt);
    const to = toIsoOrNull(changes.trialEndsAt);
    if (from !== to) entries.push({ action: 'trial_changed', details: { from, to } });
  }
  if (changes.maxClients !== undefined && changes.maxClients !== current.maxClients) {
    entries.push({
      action: 'max_clients_changed',
      details: { from: current.maxClients, to: changes.maxClients },
    });
  }
  return entries;
}

/** La prueba solo se puede dejar en el futuro (o quitar): fijar una fecha pasada no tendría sentido. */
export function isValidTrialEnd(trialEndsAt: Date | null, now: Date): boolean {
  return trialEndsAt === null || trialEndsAt.getTime() > now.getTime();
}
