import { type TimeEntryView } from '../application/ports/time-entry.repository';

export function serializeTimeEntry(entry: TimeEntryView): Record<string, unknown> {
  return {
    ...entry,
    clockInAt: entry.clockInAt.toISOString(),
    clockOutAt: entry.clockOutAt?.toISOString() ?? null,
    originalClockInAt: entry.originalClockInAt?.toISOString() ?? null,
    originalClockOutAt: entry.originalClockOutAt?.toISOString() ?? null,
    editedAt: entry.editedAt?.toISOString() ?? null,
  };
}
