import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
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
import {
  CreateScheduleSeriesUseCase,
  EndScheduleSeriesUseCase,
  ListScheduleSeriesUseCase,
  UpdateScheduleSeriesUseCase,
} from '../application/schedule.use-cases';
import { type ScheduleWeekday } from '../domain/schedule-rules';
import {
  CenterRouteParamsDto,
  CreateScheduleSeriesRequestDto,
  EndSeriesResponseDto,
  ScheduleSeriesListResponseDto,
  ScheduleSeriesWriteResponseDto,
  SeriesRouteParamsDto,
  UpdateScheduleSeriesRequestDto,
} from './schedule.dto';

/** Horarios: plantillas semanales de sesiones por sala, servicio y profesor. */
@ApiTags('schedules')
@ApiBearerAuth('bearer')
@ApiHeader({ name: 'X-Center-Id', required: true })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('centers/:centerId/schedules')
export class SchedulesController {
  constructor(
    private readonly listSeries: ListScheduleSeriesUseCase,
    private readonly createSeries: CreateScheduleSeriesUseCase,
    private readonly updateSeries: UpdateScheduleSeriesUseCase,
    private readonly endSeries: EndScheduleSeriesUseCase,
    private readonly activity: ActivityRecorder,
  ) {}

  @Get()
  @Roles('owner', 'admin', 'staff')
  @ApiOperation({
    operationId: 'schedules_list',
    summary:
      'Los horarios del centro (activos primero), cada uno con sus días de la semana, sala, profesor, modo, aforo y matriculados. De paso crea las sesiones que falten hasta 8 semanas por delante.',
  })
  @ApiOkResponse({ type: ScheduleSeriesListResponseDto })
  async list(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterRouteParamsDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    return { series: await this.listSeries.execute(actor) };
  }

  @Post()
  @Roles('owner', 'admin')
  @ApiOperation({
    operationId: 'schedules_create',
    summary:
      'Crea un horario (uno o varios días de la semana a la misma hora) y sus sesiones de las próximas 8 semanas. Devuelve las fechas que no se pudieron crear (festivo, ausencia, sala o profesor ocupados, sala bloqueada). 409 SESSION_MODE_NOT_ALLOWED si el servicio no admite ese modo; ROOM_UNAVAILABLE si la sala no sirve para ese servicio o esa persona.',
  })
  @ApiCreatedResponse({ type: ScheduleSeriesWriteResponseDto })
  async create(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterRouteParamsDto,
    @Body() body: CreateScheduleSeriesRequestDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const outcome = await this.createSeries.execute(actor, {
      serviceId: body.serviceId,
      staffMembershipId: body.staffMembershipId ?? null,
      roomId: body.roomId ?? null,
      mode: body.mode,
      capacity: body.capacity ?? null,
      weekdays: body.weekdays as ScheduleWeekday[],
      startsAtTime: body.startsAtTime,
      endsAtTime: body.endsAtTime,
      startsOn: body.startsOn,
      endsOn: body.endsOn,
      label: body.label ?? null,
    });
    await this.activity.record(actor, {
      kind: 'schedule_created',
      subject: outcome.series.label ?? outcome.series.service.name,
    });
    return { ...outcome };
  }

  @Patch(':seriesId')
  @Roles('owner', 'admin')
  @ApiOperation({
    operationId: 'schedules_update',
    summary:
      'Cambia un horario. Cambiar la hora, la sala o el profesor rehace las sesiones futuras; 409 SCHEDULE_HAS_BOOKINGS si alguna tiene citas sueltas. El aforo y la etiqueta se cambian sin tocar nada; acortar el periodo cancela lo que queda después.',
  })
  @ApiOkResponse({ type: ScheduleSeriesWriteResponseDto })
  async update(
    @CurrentActor() actor: ActorContext,
    @Param() params: SeriesRouteParamsDto,
    @Body() body: UpdateScheduleSeriesRequestDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const outcome = await this.updateSeries.execute(actor, params.seriesId, body);
    await this.activity.record(actor, {
      kind: 'schedule_updated',
      subject: outcome.series.label ?? outcome.series.service.name,
    });
    return { ...outcome };
  }

  @Post(':seriesId/end')
  @Roles('owner', 'admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'schedules_end',
    summary:
      'Termina un horario: cancela sus sesiones futuras (salvo las que tengan citas sueltas), da de baja a los matriculados y les avisa. Las sesiones pasadas se conservan.',
  })
  @ApiOkResponse({ type: EndSeriesResponseDto })
  async end(
    @CurrentActor() actor: ActorContext,
    @Param() params: SeriesRouteParamsDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const outcome = await this.endSeries.execute(actor, params.seriesId);
    await this.activity.record(actor, { kind: 'schedule_ended' });
    return { keptSessionCount: outcome.keptSessionCount };
  }
}
