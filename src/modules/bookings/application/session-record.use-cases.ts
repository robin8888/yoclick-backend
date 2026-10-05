import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '../../../shared/errors/domain-error';
import { HTTP_STATUS } from '../../../shared/errors/http-status';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import {
  calculateActualDurationSeconds,
  calculatePlannedDurationSeconds,
  isSessionOpen,
  summarizeSessionRecordsByStaff,
  type StaffSessionTotals,
} from '../domain/session-record';
import { type BookingView } from './ports/booking.repository';
import {
  SESSION_RECORD_REPOSITORY,
  type SessionRecordRepository,
  type SessionRecordsQuery,
} from './ports/session-record.repository';

/** Quien atiende inicia su clase; el servidor guarda la hora, la app solo la muestra. */
@Injectable()
export class StartSessionUseCase {
  constructor(
    @Inject(SESSION_RECORD_REPOSITORY) private readonly sessionRecords: SessionRecordRepository,
  ) {}

  async execute(input: {
    actor: ActorContext;
    bookingId: string;
    now: Date;
  }): Promise<BookingView> {
    const outcome = await this.sessionRecords.startSession(input.actor, {
      bookingId: input.bookingId,
      now: input.now,
    });
    if (outcome.kind === 'started' || outcome.kind === 'already_started') return outcome.booking;
    if (outcome.kind === 'not_found') throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
    if (outcome.kind === 'not_startable') {
      throw new DomainError('BOOKING_NOT_STARTABLE', HTTP_STATUS.conflict);
    }
    throw new DomainError('SESSION_ALREADY_OPEN', HTTP_STATUS.conflict);
  }
}

@Injectable()
export class EndSessionUseCase {
  constructor(
    @Inject(SESSION_RECORD_REPOSITORY) private readonly sessionRecords: SessionRecordRepository,
  ) {}

  async execute(input: {
    actor: ActorContext;
    bookingId: string;
    notes: string | null;
    now: Date;
  }): Promise<BookingView> {
    const outcome = await this.sessionRecords.endSession(input.actor, {
      bookingId: input.bookingId,
      now: input.now,
      notes: input.notes,
    });
    if (outcome.kind === 'ended' || outcome.kind === 'already_ended') return outcome.booking;
    if (outcome.kind === 'not_found') throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
    throw new DomainError('SESSION_NOT_STARTED', HTTP_STATUS.conflict);
  }
}

export interface SessionRecordItem {
  readonly booking: BookingView;
  readonly client: { readonly membershipId: string; readonly fullName: string };
  readonly plannedDurationSeconds: number;
  readonly actualDurationSeconds: number | null;
  readonly isOpen: boolean;
  readonly notes: string | null;
}

export interface SessionRecordsReport {
  readonly timeZone: string;
  readonly records: readonly SessionRecordItem[];
  readonly totals: readonly StaffSessionTotals[];
}

/** El informe de clases de administración: lo iniciado y lo que debió darse y no se registró. */
@Injectable()
export class ListSessionRecordsUseCase {
  constructor(
    @Inject(SESSION_RECORD_REPOSITORY) private readonly sessionRecords: SessionRecordRepository,
  ) {}

  async execute(input: {
    actor: ActorContext;
    query: SessionRecordsQuery;
  }): Promise<SessionRecordsReport> {
    const found = await this.sessionRecords.listSessionRecords(input.actor, input.query);
    const records = found.entries.map(({ booking, client, notes }) => ({
      booking,
      client,
      notes,
      plannedDurationSeconds: calculatePlannedDurationSeconds(booking),
      actualDurationSeconds: calculateActualDurationSeconds(booking),
      isOpen: isSessionOpen(booking),
    }));
    const totals = summarizeSessionRecordsByStaff(
      records.map((record) => ({ ...record, staff: record.booking.staff })),
    );
    return { timeZone: found.timeZone, records, totals };
  }
}
