import { Inject, Injectable } from '@nestjs/common';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { buildCenterReport, type CenterReport, type ReportPeriod } from '../domain/center-report';
import {
  CENTER_REPORT_REPOSITORY,
  type CenterReportRepository,
} from './ports/center-report.repository';

@Injectable()
export class GetCenterReportUseCase {
  constructor(@Inject(CENTER_REPORT_REPOSITORY) private readonly reports: CenterReportRepository) {}

  async execute(request: {
    readonly actor: ActorContext;
    readonly period: ReportPeriod;
  }): Promise<CenterReport> {
    const facts = await this.reports.findFacts(request.actor, new Date());
    return buildCenterReport(facts, request.period);
  }
}
