import { type ActorContext } from '../../../../shared/tenancy/actor-context';
import { type OpeningHours } from '../../../centers/domain/opening-hours';
import { type BusyInterval, type StaffCandidate } from '../../domain/available-slots';

/** Lo que hay que saber de un servicio para ofrecer sus huecos y reservarlo. */
export interface SchedulableService {
  readonly id: string;
  readonly name: string;
  readonly color: string | null;
  readonly durationMinutes: number;
  readonly minNoticeMinutes: number;
  readonly bookingWindowDays: number;
}

export interface SchedulingFacts {
  readonly service: SchedulableService;
  readonly timeZone: string;
  readonly openingHours: OpeningHours | null;
  readonly holidayDates: readonly string[];
  /** Quienes atienden el servicio ahora mismo (equipo activo). */
  readonly staff: readonly StaffCandidate[];
  /** Sesiones ya programadas de esas personas en el rango de fechas consultado. */
  readonly busyIntervals: readonly BusyInterval[];
}

export interface SchedulingFactsQuery {
  readonly serviceId: string;
  /** El equipo puede consultar servicios ocultos (para probarlos); la clientela, no. */
  readonly canSeeHiddenService: boolean;
  readonly dateRange: SchedulingDateRange;
}

/**
 * Fechas locales del centro, ambas incluidas, o el día local en el que cae un instante (al reservar
 * solo se conoce la hora UTC; la fecha local depende de la zona del centro, que se lee aquí).
 */
export type SchedulingDateRange =
  { readonly fromDate: string; readonly toDate: string } | { readonly aroundInstant: Date };

export interface SchedulingFactsRepository {
  /** `null` si el servicio no existe, está archivado, o es oculto y quien pregunta es clientela. */
  findFacts(actor: ActorContext, query: SchedulingFactsQuery): Promise<SchedulingFacts | null>;
}

export const SCHEDULING_FACTS_REPOSITORY = Symbol('SCHEDULING_FACTS_REPOSITORY');
