import { type WaitlistEntryView } from '../application/ports/waitlist.repository';

export function serializeWaitlistEntry(entry: WaitlistEntryView): Record<string, unknown> {
  return {
    id: entry.id,
    status: entry.status,
    classSessionId: entry.classSessionId,
    createdAt: entry.createdAt.toISOString(),
    position: entry.position,
    offerExpiresAt: entry.offerExpiresAt?.toISOString() ?? null,
    session: {
      startsAt: entry.session.startsAt.toISOString(),
      endsAt: entry.session.endsAt.toISOString(),
      service: entry.session.service,
    },
  };
}
