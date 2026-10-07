import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiDefaultResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentActor } from '../../../shared/auth/decorators/current-actor.decorator';
import { Roles } from '../../../shared/auth/decorators/roles.decorator';
import { AllowStaffWithPermission } from '../../../shared/auth/decorators/staff-permission.decorator';
import { ProblemDetailsDto } from '../../../shared/errors/problem-details.dto';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { assertRouteTargetsActorCenter } from '../../../shared/tenancy/assert-route-targets-actor-center';
import { GetCenterReportUseCase } from '../application/get-center-report.use-case';
import {
  CenterReportQueryDto,
  CenterReportResponseDto,
  ReportRouteParamsDto,
} from './center-report.dto';

@ApiTags('reports')
@ApiBearerAuth('bearer')
@ApiHeader({ name: 'X-Center-Id', required: true })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('centers/:centerId/reports')
export class CenterReportController {
  constructor(private readonly getCenterReport: GetCenterReportUseCase) {}

  @Get()
  @Roles('owner', 'admin')
  @AllowStaffWithPermission('reports:view')
  @ApiOperation({
    operationId: 'reports_get_center_report',
    summary:
      'Informes del centro de la última semana, mes (30 días) o trimestre (90 días): ingresos estimados por las citas, ocupación, retención, clientes inactivos, ocupación por servicio, horas por profesional y retención por mes de alta.',
  })
  @ApiOkResponse({ type: CenterReportResponseDto })
  async getReport(
    @CurrentActor() actor: ActorContext,
    @Param() params: ReportRouteParamsDto,
    @Query() query: CenterReportQueryDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const { range, ...report } = await this.getCenterReport.execute({
      actor,
      period: query.period,
    });
    return { ...report, fromDate: range.fromDate, toDate: range.toDate };
  }
}
