import { type ActorContext } from '../../../../shared/tenancy/actor-context';
import { type ReportFacts } from '../../domain/center-report';

export interface CenterReportRepository {
  /** Los datos en bruto de los últimos seis meses; las cuentas las hace el dominio. */
  findFacts(actor: ActorContext, now: Date): Promise<ReportFacts>;
}

export const CENTER_REPORT_REPOSITORY = Symbol('CENTER_REPORT_REPOSITORY');
