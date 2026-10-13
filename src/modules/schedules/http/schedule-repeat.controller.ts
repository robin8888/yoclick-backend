import { Body, Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
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
import { ActivityRecorder } from '../../activity/application/activity-recorder';
import { RepeatWeekUseCase } from '../application/schedule.use-cases';
import { CenterRouteParamsDto, RepeatWeekRequestDto, RepeatWeekResponseDto } from './schedule.dto';

/** Copiar una semana configurada a la siguiente con un solo gesto. */
@ApiTags('schedules')
@ApiBearerAuth('bearer')
@ApiHeader({ name: 'X-Center-Id', required: true })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('centers/:centerId/schedules')
export class ScheduleRepeatController {
  constructor(
    private readonly repeatWeek: RepeatWeekUseCase,
    private readonly activity: ActivityRecorder,
  ) {}

  @Post('repeat-week')
  @Roles('owner', 'admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'schedules_repeat_week',
    summary:
      'Copia a la semana siguiente todos los horarios de una semana (los que empiezan y terminan dentro de ella): mismo servicio, sala, profesor, horas y aforo. Los que ya estaban copiados no se duplican; las fechas que chocan se devuelven en `skipped`.',
  })
  @ApiOkResponse({ type: RepeatWeekResponseDto })
  async repeat(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterRouteParamsDto,
    @Body() body: RepeatWeekRequestDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const outcome = await this.repeatWeek.execute(actor, body.weekStart);
    await this.activity.record(actor, { kind: 'schedule_created', subject: body.weekStart });
    return { ...outcome };
  }
}
