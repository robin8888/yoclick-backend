import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '../../../shared/errors/domain-error';
import { HTTP_STATUS } from '../../../shared/errors/http-status';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import {
  summarizeMonth,
  type MonthTotals,
  type TimeEntryViolation,
} from '../domain/time-entry-rules';
import {
  TIME_ENTRY_REPOSITORY,
  type TeamClockScanOutcome,
  type TimeEntryChangeOutcome,
  type TimeEntryRepository,
  type TimeEntryView,
} from './ports/time-entry.repository';

const VIOLATION_ERROR_CODE = {
  out_not_after_in: 'TIME_ENTRY_INVALID_RANGE',
  too_long: 'TIME_ENTRY_TOO_LONG',
  in_future: 'TIME_ENTRY_IN_FUTURE',
} as const satisfies Record<TimeEntryViolation, string>;

function unwrapChange(outcome: TimeEntryChangeOutcome): TimeEntryView {
  if (outcome.kind === 'saved') return outcome.entry;
  if (outcome.kind === 'overlap') {
    throw new DomainError('TIME_ENTRY_OVERLAP', HTTP_STATUS.conflict);
  }
  if (outcome.kind === 'violation') {
    throw new DomainError(VIOLATION_ERROR_CODE[outcome.violation], HTTP_STATUS.unprocessableEntity);
  }
  throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
}

/** El fichaje de quien enseña el QR; lo usa el escáner de asistencia, que no conoce el reloj. */
@Injectable()
export class RecordTeamClockScanUseCase {
  constructor(@Inject(TIME_ENTRY_REPOSITORY) private readonly timeEntries: TimeEntryRepository) {}

  async execute(
    actor: ActorContext,
    command: { scannedMembershipId: string; now: Date },
  ): Promise<TeamClockScanOutcome> {
    return this.timeEntries.recordTeamScan(actor, command);
  }
}

export interface MonthTimeEntries {
  readonly month: string;
  readonly staffMembershipId: string;
  readonly entries: readonly TimeEntryView[];
  readonly totals: MonthTotals;
}

@Injectable()
export class ListTimeEntriesUseCase {
  constructor(@Inject(TIME_ENTRY_REPOSITORY) private readonly timeEntries: TimeEntryRepository) {}

  async execute(
    actor: ActorContext,
    query: { month: string; staffMembershipId?: string | undefined },
  ): Promise<MonthTimeEntries> {
    const staffMembershipId = query.staffMembershipId ?? actor.membershipId;
    const isOwnEntries = staffMembershipId === actor.membershipId;
    // La API decide quién ve a quién: el personal solo su propio registro.
    if (!isOwnEntries && actor.role === 'staff') {
      throw new DomainError('FORBIDDEN', HTTP_STATUS.forbidden);
    }
    const entries = await this.timeEntries.listForMonth(actor, {
      staffMembershipId,
      month: query.month,
    });
    return { month: query.month, staffMembershipId, entries, totals: summarizeMonth(entries) };
  }
}

@Injectable()
export class CreateTimeEntryUseCase {
  constructor(@Inject(TIME_ENTRY_REPOSITORY) private readonly timeEntries: TimeEntryRepository) {}

  async execute(
    actor: ActorContext,
    input: { clockInAt: Date; clockOutAt: Date; now: Date },
  ): Promise<TimeEntryView> {
    const outcome = await this.timeEntries.create(actor, {
      ...input,
      staffMembershipId: actor.membershipId,
    });
    return unwrapChange(outcome);
  }
}

@Injectable()
export class UpdateTimeEntryUseCase {
  constructor(@Inject(TIME_ENTRY_REPOSITORY) private readonly timeEntries: TimeEntryRepository) {}

  async execute(
    actor: ActorContext,
    patch: {
      entryId: string;
      clockInAt?: Date | undefined;
      clockOutAt?: Date | undefined;
      now: Date;
    },
  ): Promise<TimeEntryView> {
    return unwrapChange(await this.timeEntries.update(actor, patch));
  }
}

@Injectable()
export class DeleteTimeEntryUseCase {
  constructor(@Inject(TIME_ENTRY_REPOSITORY) private readonly timeEntries: TimeEntryRepository) {}

  async execute(actor: ActorContext, command: { entryId: string; now: Date }): Promise<void> {
    const wasDeleted = await this.timeEntries.softDelete(actor, command);
    if (!wasDeleted) throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
  }
}
