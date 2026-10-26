import { RequiresModule } from '../../../shared/auth/decorators/requires-module.decorator';
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
import { CancelSessionDayUseCase, MoveSessionDayUseCase } from '../application/schedule.use-cases';
import {
  CancelSessionRequestDto,
  CancelSessionResponseDto,
  MoveSessionRequestDto,
  MoveSessionResponseDto,
  SessionRouteParamsDto,
} from './schedule.dto';

/** Cancelar o mover un día: una sesión concreta con todas sus plazas. */
@ApiTags('schedules')
@ApiBearerAuth('bearer')
@ApiHeader({ name: 'X-Center-Id', required: true })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@RequiresModule('rooms')
@Controller('centers/:centerId/sessions')
export class SessionCancellationController {
  constructor(
    private readonly cancelSessionDay: CancelSessionDayUseCase,
    private readonly moveSessionDay: MoveSessionDayUseCase,
    private readonly activity: ActivityRecorder,
  ) {}

  @Post(':sessionId/cancel')
  @Roles('owner', 'admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'sessions_cancel',
    summary:
      'Cancela una sesión que no ha empezado (festivo, profesor enfermo…) con todas sus plazas, sin gastar bono a nadie, y avisa a cada persona y a quien la daba. 409 SESSION_NOT_CANCELLABLE si ya empezó.',
  })
  @ApiOkResponse({ type: CancelSessionResponseDto })
  async cancel(
    @CurrentActor() actor: ActorContext,
    @Param() params: SessionRouteParamsDto,
    @Body() body: CancelSessionRequestDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const outcome = await this.cancelSessionDay.execute(actor, {
      sessionId: params.sessionId,
      reason: body.reason,
    });
    await this.activity.record(actor, { kind: 'session_cancelled', subject: body.reason });
    return { affectedBookingCount: outcome.affectedBookingCount };
  }

  @Post(':sessionId/move')
  @Roles('owner', 'admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'sessions_move',
    summary:
      'Mueve una sola sesión que no ha empezado a otra fecha u hora (la serie no cambia). Las plazas se van con ella y se avisa a cada persona y a quien la da. 409 si ya empezó, si la sala o el profesor están ocupados o si alguien con plaza tiene otra cita a esa hora.',
  })
  @ApiOkResponse({ type: MoveSessionResponseDto })
  async move(
    @CurrentActor() actor: ActorContext,
    @Param() params: SessionRouteParamsDto,
    @Body() body: MoveSessionRequestDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const outcome = await this.moveSessionDay.execute(actor, {
      sessionId: params.sessionId,
      date: body.date,
      startsAtTime: body.startsAtTime,
      endsAtTime: body.endsAtTime,
      location: body.location,
    });
    await this.activity.record(actor, { kind: 'session_moved' });
    return { notifiedPersonCount: outcome.notifiedPersonCount };
  }
}
