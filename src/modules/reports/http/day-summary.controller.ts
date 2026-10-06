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
import { ProblemDetailsDto } from '../../../shared/errors/problem-details.dto';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { assertRouteTargetsActorCenter } from '../../../shared/tenancy/assert-route-targets-actor-center';
import { GetCenterDaySummaryUseCase } from '../application/get-center-day-summary.use-case';
import { CenterRouteParamsDto, DaySummaryQueryDto, DaySummaryResponseDto } from './day-summary.dto';

@ApiTags('reports')
@ApiBearerAuth('bearer')
@ApiHeader({ name: 'X-Center-Id', required: true })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('centers/:centerId/agenda/summary')
export class DaySummaryController {
  constructor(private readonly getCenterDaySummary: GetCenterDaySummaryUseCase) {}

  @Get()
  @Roles('owner', 'admin')
  @ApiOperation({
    operationId: 'agenda_get_day_summary',
    summary:
      'Cifras de la cabecera de la agenda del centro: ocupación del día (tiempo reservado sobre el tiempo abierto del equipo que atiende servicios), clientes nuevos de la semana y clientes activos.',
  })
  @ApiOkResponse({ type: DaySummaryResponseDto })
  async getSummary(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterRouteParamsDto,
    @Query() query: DaySummaryQueryDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    return { ...(await this.getCenterDaySummary.execute({ actor, date: query.date })) };
  }
}
