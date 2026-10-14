import { computeWorkedMinutes } from '../domain/time-entry-rules';
import {
  type TimeEntrySourceName,
  type TimeEntryView,
} from '../application/ports/time-entry.repository';

const ISO_DATE_LENGTH = 'YYYY-MM-DD'.length;

export interface StoredTimeEntry {
  readonly id: string;
  readonly staffMembershipId: string;
  readonly workDate: Date;
  readonly clockInAt: Date;
  readonly clockOutAt: Date | null;
  readonly inSource: TimeEntrySourceName;
  readonly outSource: TimeEntrySourceName | null;
  readonly isEdited: boolean;
  readonly originalClockInAt: Date | null;
  readonly originalClockOutAt: Date | null;
  readonly editedAt: Date | null;
}

/** La columna DATE llega como medianoche UTC: su fecha es la local del centro, sin convertir. */
export function toWorkDateString(workDate: Date): string {
  return workDate.toISOString().slice(0, ISO_DATE_LENGTH);
}

export function toWorkDateColumn(workDate: string): Date {
  return new Date(`${workDate}T00:00:00.000Z`);
}

export function toTimeEntryView(stored: StoredTimeEntry): TimeEntryView {
  return {
    id: stored.id,
    staffMembershipId: stored.staffMembershipId,
    workDate: toWorkDateString(stored.workDate),
    clockInAt: stored.clockInAt,
    clockOutAt: stored.clockOutAt,
    isOpen: stored.clockOutAt === null,
    workedMinutes: computeWorkedMinutes(stored),
    inSource: stored.inSource,
    outSource: stored.outSource,
    isEdited: stored.isEdited,
    originalClockInAt: stored.originalClockInAt,
    originalClockOutAt: stored.originalClockOutAt,
    editedAt: stored.editedAt,
  };
}
