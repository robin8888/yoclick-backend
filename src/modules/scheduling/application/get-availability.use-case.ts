import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '../../../shared/errors/domain-error';
import { HTTP_STATUS } from '../../../shared/errors/http-status';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { calculateAvailableSlots } from '../domain/available-slots';
import { isAvailabilityRangeAllowed } from '../domain/availability-range';
import {
  SCHEDULING_FACTS_REPOSITORY,
  type SchedulingFactsRepository,
} from './ports/scheduling-facts.repository';

export interface AvailabilityRequest {
  readonly actor: ActorContext;
  readonly serviceId: string;
  readonly fromDate: string;
  readonly toDate: string;
  readonly staffMembershipId: string | null;
  readonly now: Date;
}

export interface AvailableSlotOffer {
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly staffMembershipId: string;
  readonly staffName: string;
}

export interface AvailabilityResult {
  readonly timeZone: string;
  readonly days: readonly {
    readonly date: string;
    readonly slots: readonly AvailableSlotOffer[];
  }[];
}

/**
 * Huecos reservables de un servicio entre dos fechas. Un solo hueco por hora de inicio: si varias
 * personas están libres, se ofrece la que menos citas tiene ese día.
 */
@Injectable()
export class GetAvailabilityUseCase {
  constructor(
    @Inject(SCHEDULING_FACTS_REPOSITORY) private readonly facts: SchedulingFactsRepository,
  ) {}

  async execute(request: AvailabilityRequest): Promise<AvailabilityResult> {
    const { actor, fromDate, toDate } = request;
    if (!isAvailabilityRangeAllowed(fromDate, toDate)) {
      throw new DomainError('VALIDATION_FAILED', HTTP_STATUS.badRequest, [
        { path: 'to', code: 'invalid_range' },
      ]);
    }
    const facts = await this.facts.findFacts(actor, {
      serviceId: request.serviceId,
      canSeeHiddenService: actor.role !== 'client',
      dateRange: { fromDate, toDate },
    });
    if (!facts) throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);

    const days = calculateAvailableSlots({
      ...facts,
      ...facts.service,
      fromDate,
      toDate,
      now: request.now,
      staff: facts.staff.filter(
        (member) =>
          request.staffMembershipId === null || member.membershipId === request.staffMembershipId,
      ),
    });
    return {
      timeZone: facts.timeZone,
      days: days.map((day) => ({
        date: day.date,
        slots: day.slots.flatMap(toOffer),
      })),
    };
  }
}

function toOffer(slot: {
  startsAt: Date;
  endsAt: Date;
  freeStaff: readonly { membershipId: string; fullName: string }[];
}): AvailableSlotOffer[] {
  const [firstChoice] = slot.freeStaff;
  if (!firstChoice) return [];
  return [
    {
      startsAt: slot.startsAt,
      endsAt: slot.endsAt,
      staffMembershipId: firstChoice.membershipId,
      staffName: firstChoice.fullName,
    },
  ];
}
