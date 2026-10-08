import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
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
import {
  GetRoutineProgressUseCase,
  RecordRoutineCompletionUseCase,
} from '../application/routine.use-cases';
import {
  RecordCompletionRequestDto,
  RoutineCompletionResponseDto,
  RoutineProgressResponseDto,
  RoutineRouteParamsDto,
} from './routine.dto';

/** Lo que cada persona lleva hecho de una rutina: ella lo registra y el equipo lo consulta. */
@ApiTags('routines')
@ApiBearerAuth('bearer')
@ApiHeader({ name: 'X-Center-Id', required: true })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('centers/:centerId')
export class RoutineProgressController {
  constructor(
    private readonly recordCompletion: RecordRoutineCompletionUseCase,
    private readonly getProgress: GetRoutineProgressUseCase,
  ) {}

  @Post('routines/:routineId/completions')
  @Roles('client')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    operationId: 'routines_record_completion',
    summary:
      'Registra «hoy hice esta rutina» con cuántos ejercicios marcó. Solo si la tiene asignada (directamente o por su grupo). Una vez por día local del centro: repetirlo devuelve lo ya registrado (isNew=false). 400 si marca 0 o más ejercicios de los que tiene.',
  })
  @ApiCreatedResponse({ type: RoutineCompletionResponseDto })
  async record(
    @CurrentActor() actor: ActorContext,
    @Param() params: RoutineRouteParamsDto,
    @Body() body: RecordCompletionRequestDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const outcome = await this.recordCompletion.execute({
      actor,
      routineId: params.routineId,
      completedItemCount: body.completedItemCount,
      now: new Date(),
    });
    return {
      ...outcome.completion,
      completedAt: outcome.completion.completedAt.toISOString(),
      isNew: outcome.kind === 'recorded',
    };
  }

  @Get('routines/:routineId/progress')
  @Roles('owner', 'admin', 'staff')
  @ApiOperation({
    operationId: 'routines_get_progress',
    summary:
      'Cuántas veces ha registrado la rutina cada persona que la tiene (directamente o por su grupo), por nombre.',
  })
  @ApiOkResponse({ type: RoutineProgressResponseDto })
  async progress(
    @CurrentActor() actor: ActorContext,
    @Param() params: RoutineRouteParamsDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const people = await this.getProgress.execute(actor, params.routineId);
    return {
      people: people.map((person) => ({
        ...person,
        lastCompletedAt: person.lastCompletedAt?.toISOString() ?? null,
      })),
    };
  }
}
