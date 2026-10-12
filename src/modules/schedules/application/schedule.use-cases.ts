import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '../../../shared/errors/domain-error';
import { HTTP_STATUS } from '../../../shared/errors/http-status';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import {
  SCHEDULE_REPOSITORY,
  type EndSeriesOutcome,
  type EnrollmentView,
  type EnrollOutcome,
  type NewEnrollments,
  type NewRoomBlock,
  type NewScheduleSeries,
  type RoomBlockCreationOutcome,
  type RoomBlockView,
  type ScheduleRepository,
  type ScheduleSeriesCreationOutcome,
  type ScheduleSeriesPatch,
  type ScheduleSeriesUpdateOutcome,
  type ScheduleSeriesView,
  type SessionCancellation,
  type SkippedOccurrence,
  type UnenrollOutcome,
} from './ports/schedule.repository';

export interface SeriesWithSkipped {
  readonly series: ScheduleSeriesView;
  readonly skipped: readonly SkippedOccurrence[];
}

function invalidField(path: string, code: string): DomainError {
  return new DomainError('VALIDATION_FAILED', HTTP_STATUS.badRequest, [{ path, code }]);
}

type SeriesRefusal = Exclude<
  ScheduleSeriesCreationOutcome | ScheduleSeriesUpdateOutcome,
  { kind: 'created' } | { kind: 'updated' }
>;

/** Cada motivo por el que no se puede guardar una serie, con el error que ve la app. */
function toSeriesError(outcome: SeriesRefusal): DomainError {
  switch (outcome.kind) {
    case 'service_not_found':
      return invalidField('serviceId', 'unknown_service');
    case 'staff_not_found':
      return invalidField('staffMembershipId', 'unknown_staff_member');
    case 'staff_required':
      return invalidField('staffMembershipId', 'staff_required');
    case 'room_not_found':
      return invalidField('roomId', 'unknown_room');
    case 'limit_reached':
      return invalidField('weekdays', 'too_many_schedules');
    case 'mode_not_allowed':
      return new DomainError('SESSION_MODE_NOT_ALLOWED', HTTP_STATUS.conflict);
    case 'room_not_for_service':
      return new DomainError('ROOM_UNAVAILABLE', HTTP_STATUS.conflict);
    case 'has_single_bookings':
      return new DomainError('SCHEDULE_HAS_BOOKINGS', HTTP_STATUS.conflict);
    case 'not_found':
      return new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
  }
}

@Injectable()
export class ListScheduleSeriesUseCase {
  constructor(@Inject(SCHEDULE_REPOSITORY) private readonly schedules: ScheduleRepository) {}

  async execute(actor: ActorContext): Promise<ScheduleSeriesView[]> {
    return this.schedules.listSeries(actor, { now: new Date() });
  }
}

@Injectable()
export class CreateScheduleSeriesUseCase {
  constructor(@Inject(SCHEDULE_REPOSITORY) private readonly schedules: ScheduleRepository) {}

  async execute(actor: ActorContext, newSeries: NewScheduleSeries): Promise<SeriesWithSkipped> {
    const outcome = await this.schedules.createSeries(actor, newSeries, new Date());
    if (outcome.kind === 'created') return outcome;
    throw toSeriesError(outcome);
  }
}

@Injectable()
export class UpdateScheduleSeriesUseCase {
  constructor(@Inject(SCHEDULE_REPOSITORY) private readonly schedules: ScheduleRepository) {}

  async execute(
    actor: ActorContext,
    seriesId: string,
    patch: ScheduleSeriesPatch,
  ): Promise<SeriesWithSkipped> {
    const outcome = await this.schedules.updateSeries(actor, { seriesId, patch, now: new Date() });
    if (outcome.kind === 'updated') return outcome;
    throw toSeriesError(outcome);
  }
}

@Injectable()
export class EndScheduleSeriesUseCase {
  constructor(@Inject(SCHEDULE_REPOSITORY) private readonly schedules: ScheduleRepository) {}

  async execute(
    actor: ActorContext,
    seriesId: string,
  ): Promise<Extract<EndSeriesOutcome, { kind: 'ended' }>> {
    const outcome = await this.schedules.endSeries(actor, { seriesId, now: new Date() });
    if (outcome.kind === 'ended') return outcome;
    throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
  }
}

@Injectable()
export class ListEnrollmentsUseCase {
  constructor(@Inject(SCHEDULE_REPOSITORY) private readonly schedules: ScheduleRepository) {}

  async execute(actor: ActorContext, seriesId: string): Promise<EnrollmentView[]> {
    const enrollments = await this.schedules.listEnrollments(actor, seriesId);
    if (enrollments === null) throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
    return enrollments;
  }
}

@Injectable()
export class EnrollClientsUseCase {
  constructor(@Inject(SCHEDULE_REPOSITORY) private readonly schedules: ScheduleRepository) {}

  async execute(
    actor: ActorContext,
    request: NewEnrollments,
  ): Promise<Extract<EnrollOutcome, { kind: 'enrolled' }>> {
    const outcome = await this.schedules.enroll(actor, { ...request, now: new Date() });
    if (outcome.kind === 'enrolled') return outcome;
    throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
  }
}

@Injectable()
export class UnenrollClientUseCase {
  constructor(@Inject(SCHEDULE_REPOSITORY) private readonly schedules: ScheduleRepository) {}

  async execute(
    actor: ActorContext,
    request: { seriesId: string; enrollmentId: string },
  ): Promise<Extract<UnenrollOutcome, { kind: 'unenrolled' }>> {
    const outcome = await this.schedules.unenroll(actor, { ...request, now: new Date() });
    if (outcome.kind === 'unenrolled') return outcome;
    throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
  }
}

/** Cancelar un día: la sesión y todas sus plazas, con aviso. Solo sesiones que no han empezado. */
@Injectable()
export class CancelSessionDayUseCase {
  constructor(@Inject(SCHEDULE_REPOSITORY) private readonly schedules: ScheduleRepository) {}

  async execute(
    actor: ActorContext,
    cancellation: Omit<SessionCancellation, 'now'>,
  ): Promise<{ affectedBookingCount: number }> {
    const outcome = await this.schedules.cancelSession(actor, { ...cancellation, now: new Date() });
    if (outcome.kind === 'cancelled') return outcome;
    if (outcome.kind === 'not_found') throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
    throw new DomainError('SESSION_NOT_CANCELLABLE', HTTP_STATUS.conflict);
  }
}

@Injectable()
export class ListRoomBlocksUseCase {
  constructor(@Inject(SCHEDULE_REPOSITORY) private readonly schedules: ScheduleRepository) {}

  async execute(
    actor: ActorContext,
    query: { roomId: string | null; from: Date; to: Date },
  ): Promise<RoomBlockView[]> {
    return this.schedules.listBlocks(actor, query);
  }
}

@Injectable()
export class CreateRoomBlockUseCase {
  constructor(@Inject(SCHEDULE_REPOSITORY) private readonly schedules: ScheduleRepository) {}

  async execute(
    actor: ActorContext,
    newBlock: NewRoomBlock,
  ): Promise<Extract<RoomBlockCreationOutcome, { kind: 'created' }>> {
    const outcome = await this.schedules.createBlock(actor, newBlock);
    if (outcome.kind === 'created') return outcome;
    if (outcome.kind === 'room_not_found') throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
    if (outcome.kind === 'has_bookings') {
      throw new DomainError('ROOM_HAS_BOOKINGS', HTTP_STATUS.conflict);
    }
    throw new DomainError('CONFLICT', HTTP_STATUS.conflict, [
      { path: 'startsAt', code: 'overlaps_block' },
    ]);
  }
}

@Injectable()
export class DeleteRoomBlockUseCase {
  constructor(@Inject(SCHEDULE_REPOSITORY) private readonly schedules: ScheduleRepository) {}

  async execute(actor: ActorContext, request: { roomId: string; blockId: string }): Promise<void> {
    const wasDeleted = await this.schedules.deleteBlock(actor, request);
    if (!wasDeleted) throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
  }
}
