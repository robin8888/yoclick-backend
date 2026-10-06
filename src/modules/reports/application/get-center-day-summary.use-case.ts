import { Inject, Injectable } from '@nestjs/common';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { calculateOccupancyPercent, sumOpenMinutes } from '../domain/day-summary';
import { DAY_SUMMARY_REPOSITORY, type DaySummaryRepository } from './ports/day-summary.repository';

export interface CenterDaySummary {
  readonly date: string;
  /** `null` si el centro está cerrado ese día o nadie atiende servicios. */
  readonly occupancyPercent: number | null;
  readonly newClientsThisWeek: number;
  readonly activeClientCount: number;
}

/** Las cifras de la cabecera de la agenda del centro: ocupación del día y clientes nuevos de la semana. */
@Injectable()
export class GetCenterDaySummaryUseCase {
  constructor(@Inject(DAY_SUMMARY_REPOSITORY) private readonly summaries: DaySummaryRepository) {}

  async execute(request: {
    readonly actor: ActorContext;
    readonly date: string;
  }): Promise<CenterDaySummary> {
    const facts = await this.summaries.findFacts(request.actor, { date: request.date });
    return {
      date: request.date,
      occupancyPercent: calculateOccupancyPercent({
        bookedMinutes: facts.bookedMinutes,
        openMinutes: sumOpenMinutes(facts.openingHours, facts.holidayDates, request.date),
        staffCount: facts.bookableStaffCount,
      }),
      newClientsThisWeek: facts.newClientCount,
      activeClientCount: facts.activeClientCount,
    };
  }
}
