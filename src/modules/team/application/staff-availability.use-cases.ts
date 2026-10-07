import { Inject, Injectable } from '@nestjs/common';
import { v7 as generateUuidV7 } from 'uuid';
import { DomainError } from '../../../shared/errors/domain-error';
import { HTTP_STATUS } from '../../../shared/errors/http-status';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { type OpeningHours } from '../../centers/domain/opening-hours';
import {
  type AbsenceReasonName,
  type AbsenceView,
  STAFF_AVAILABILITY_REPOSITORY,
  type StaffAvailabilityRepository,
  type StaffAvailabilityView,
} from './ports/staff-availability.repository';

/** La administración gestiona la disponibilidad de todo el equipo; el personal, solo la suya. */
function assertCanManageAvailability(actor: ActorContext, membershipId: string): void {
  const isAdministration = actor.role === 'owner' || actor.role === 'admin';
  if (isAdministration || actor.membershipId === membershipId) return;
  throw new DomainError('FORBIDDEN', HTTP_STATUS.forbidden);
}

async function findAvailabilityOrFail(
  availability: StaffAvailabilityRepository,
  actor: ActorContext,
  membershipId: string,
): Promise<StaffAvailabilityView> {
  assertCanManageAvailability(actor, membershipId);
  const view = await availability.findAvailability(actor, membershipId);
  if (!view) throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
  return view;
}

@Injectable()
export class GetStaffAvailabilityUseCase {
  constructor(
    @Inject(STAFF_AVAILABILITY_REPOSITORY)
    private readonly availability: StaffAvailabilityRepository,
  ) {}

  async execute(actor: ActorContext, membershipId: string): Promise<StaffAvailabilityView> {
    return findAvailabilityOrFail(this.availability, actor, membershipId);
  }
}

@Injectable()
export class SaveStaffWeeklyHoursUseCase {
  constructor(
    @Inject(STAFF_AVAILABILITY_REPOSITORY)
    private readonly availability: StaffAvailabilityRepository,
  ) {}

  async execute(request: {
    readonly actor: ActorContext;
    readonly membershipId: string;
    readonly weeklyHours: OpeningHours | null;
  }): Promise<StaffAvailabilityView> {
    const { actor, membershipId, weeklyHours } = request;
    await findAvailabilityOrFail(this.availability, actor, membershipId);
    await this.availability.saveWeeklyHours(actor, membershipId, weeklyHours);
    return findAvailabilityOrFail(this.availability, actor, membershipId);
  }
}

export interface AddedAbsence extends AbsenceView {
  /** Citas que ya había en esas fechas: el centro decide si las reasigna o avisa. */
  readonly affectedBookingCount: number;
}

@Injectable()
export class AddStaffAbsenceUseCase {
  constructor(
    @Inject(STAFF_AVAILABILITY_REPOSITORY)
    private readonly availability: StaffAvailabilityRepository,
  ) {}

  async execute(request: {
    readonly actor: ActorContext;
    readonly membershipId: string;
    readonly startsOn: string;
    readonly endsOn: string;
    readonly reason: AbsenceReasonName;
  }): Promise<AddedAbsence> {
    const { actor, membershipId } = request;
    await findAvailabilityOrFail(this.availability, actor, membershipId);
    const absence = {
      id: generateUuidV7(),
      membershipId,
      startsOn: request.startsOn,
      endsOn: request.endsOn,
      reason: request.reason,
    };
    const { affectedBookingCount } = await this.availability.addAbsence(actor, absence);
    return {
      id: absence.id,
      startsOn: absence.startsOn,
      endsOn: absence.endsOn,
      reason: absence.reason,
      affectedBookingCount,
    };
  }
}

@Injectable()
export class RemoveStaffAbsenceUseCase {
  constructor(
    @Inject(STAFF_AVAILABILITY_REPOSITORY)
    private readonly availability: StaffAvailabilityRepository,
  ) {}

  async execute(actor: ActorContext, membershipId: string, absenceId: string): Promise<void> {
    assertCanManageAvailability(actor, membershipId);
    if (!(await this.availability.removeAbsence(actor, membershipId, absenceId))) {
      throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
    }
  }
}
