import { type ActorContext } from '../../../../shared/tenancy/actor-context';
import { type OpeningHours } from '../../../centers/domain/opening-hours';

/** Los datos en bruto del día y la semana; las cuentas las hace el dominio. */
export interface DaySummaryFacts {
  readonly timeZone: string;
  readonly openingHours: OpeningHours | null;
  readonly holidayDates: readonly string[];
  /** Equipo activo que atiende algún servicio vigente. */
  readonly bookableStaffCount: number;
  /** Duración total de las citas no canceladas del día. */
  readonly bookedMinutes: number;
  readonly newClientCount: number;
  readonly activeClientCount: number;
}

export interface DaySummaryRepository {
  findFacts(actor: ActorContext, query: { readonly date: string }): Promise<DaySummaryFacts>;
}

export const DAY_SUMMARY_REPOSITORY = Symbol('DAY_SUMMARY_REPOSITORY');
