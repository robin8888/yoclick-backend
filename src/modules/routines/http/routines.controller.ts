import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiDefaultResponse,
  ApiHeader,
  ApiNoContentResponse,
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
import { PushDispatcher } from '../../push/application/push-dispatcher';
import {
  ArchiveRoutineUseCase,
  AssignRoutineUseCase,
  CreateRoutineUseCase,
  GetExerciseLibraryUseCase,
  GetRoutineUseCase,
  ListMyRoutinesUseCase,
  ListRoutinesUseCase,
  UnassignRoutineUseCase,
} from '../application/routine.use-cases';
import {
  type ClientRoutineView,
  type RoutineDetail,
} from '../application/ports/routine.repository';
import { buildAssignmentTarget } from '../domain/routine-rules';
import {
  AssignmentRouteParamsDto,
  AssignRoutineRequestDto,
  CenterRouteParamsDto,
  CreateRoutineRequestDto,
  ExerciseLibraryResponseDto,
  MyRoutinesResponseDto,
  RoutineDetailResponseDto,
  RoutineListResponseDto,
  RoutineRouteParamsDto,
} from './routine.dto';

function serializeDetail(routine: RoutineDetail): Record<string, unknown> {
  return {
    ...routine,
    items: [...routine.items],
    assignments: routine.assignments.map((assignment) => ({
      ...assignment,
      assignedAt: assignment.assignedAt.toISOString(),
    })),
    createdAt: routine.createdAt.toISOString(),
  };
}

function serializeMine(routine: ClientRoutineView): Record<string, unknown> {
  return { ...routine, items: [...routine.items], assignedAt: routine.assignedAt.toISOString() };
}

/** Lo que se consulta: la biblioteca de ejercicios, las rutinas del centro y las que recibe una persona. */
@ApiTags('routines')
@ApiBearerAuth('bearer')
@ApiHeader({ name: 'X-Center-Id', required: true })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('centers/:centerId')
export class RoutineLibraryController {
  constructor(
    private readonly getLibrary: GetExerciseLibraryUseCase,
    private readonly listMyRoutines: ListMyRoutinesUseCase,
    private readonly listRoutines: ListRoutinesUseCase,
    private readonly getRoutine: GetRoutineUseCase,
  ) {}

  @Get('exercise-library')
  @Roles('owner', 'admin', 'staff')
  @ApiOperation({
    operationId: 'routines_get_exercise_library',
    summary: 'Los ejercicios del tipo de centro, por categorías, para armar una rutina.',
  })
  @ApiOkResponse({ type: ExerciseLibraryResponseDto })
  async library(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterRouteParamsDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    return { exercises: [...(await this.getLibrary.execute(actor))] };
  }

  @Get('routines')
  @Roles('owner', 'admin', 'staff')
  @ApiOperation({
    operationId: 'routines_list',
    summary: 'Las rutinas del centro, de la más reciente a la más antigua.',
  })
  @ApiOkResponse({ type: RoutineListResponseDto })
  async list(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterRouteParamsDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const routines = await this.listRoutines.execute(actor);
    return {
      routines: routines.map((routine) => ({
        ...routine,
        createdAt: routine.createdAt.toISOString(),
      })),
    };
  }

  @Get('routines/:routineId')
  @Roles('owner', 'admin', 'staff')
  @ApiOperation({
    operationId: 'routines_get',
    summary: 'Una rutina con sus ejercicios y a quién está asignada.',
  })
  @ApiOkResponse({ type: RoutineDetailResponseDto })
  async get(
    @CurrentActor() actor: ActorContext,
    @Param() params: RoutineRouteParamsDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    return serializeDetail(await this.getRoutine.execute(actor, params.routineId));
  }

  @Get('my-routines')
  @Roles('client')
  @ApiOperation({
    operationId: 'routines_list_mine',
    summary: 'Las rutinas que me han asignado, directamente o por mi grupo, con sus ejercicios.',
  })
  @ApiOkResponse({ type: MyRoutinesResponseDto })
  async mine(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterRouteParamsDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    return { routines: (await this.listMyRoutines.execute(actor)).map(serializeMine) };
  }
}

/** Rutinas, prácticas, secuencias o tareas: el equipo las prepara y las asigna a una persona o a un grupo. */
@ApiTags('routines')
@ApiBearerAuth('bearer')
@ApiHeader({ name: 'X-Center-Id', required: true })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('centers/:centerId')
export class RoutinesController {
  constructor(
    private readonly createRoutine: CreateRoutineUseCase,
    private readonly archiveRoutine: ArchiveRoutineUseCase,
    private readonly activity: ActivityRecorder,
    private readonly push: PushDispatcher,
  ) {}

  @Post('routines')
  @Roles('owner', 'admin', 'staff')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    operationId: 'routines_create',
    summary:
      'Crea una rutina con sus ejercicios y, si se indica, la asigna a una persona o a un grupo; quien la recibe lo sabe por un aviso push.',
  })
  @ApiCreatedResponse({ type: RoutineDetailResponseDto })
  async create(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterRouteParamsDto,
    @Body() body: CreateRoutineRequestDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const routine = await this.createRoutine.execute({
      actor,
      name: body.name,
      note: body.note,
      items: body.items,
      assignTo: body.assignTo ? buildAssignmentTarget(body.assignTo) : null,
    });
    await this.activity.record(actor, { kind: 'routine_created', subject: routine.name });
    await this.push.flushCenter(actor);
    return serializeDetail(routine);
  }

  @Delete('routines/:routineId')
  @Roles('owner', 'admin', 'staff')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    operationId: 'routines_archive',
    summary: 'Archiva una rutina: deja de verse para quien la tenía asignada.',
  })
  @ApiNoContentResponse()
  async archive(
    @CurrentActor() actor: ActorContext,
    @Param() params: RoutineRouteParamsDto,
  ): Promise<void> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    await this.archiveRoutine.execute(actor, params.routineId);
    await this.activity.record(actor, { kind: 'routine_archived' });
  }
}

/** A quién se asigna una rutina: a una persona o a un grupo. */
@ApiTags('routines')
@ApiBearerAuth('bearer')
@ApiHeader({ name: 'X-Center-Id', required: true })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('centers/:centerId')
export class RoutineAssignmentsController {
  constructor(
    private readonly assignRoutine: AssignRoutineUseCase,
    private readonly unassignRoutine: UnassignRoutineUseCase,
    private readonly activity: ActivityRecorder,
    private readonly push: PushDispatcher,
  ) {}

  @Post('routines/:routineId/assignments')
  @Roles('owner', 'admin', 'staff')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    operationId: 'routines_assign',
    summary:
      'Asigna la rutina a una persona o a un grupo y les avisa por push. 409 ROUTINE_ALREADY_ASSIGNED si ya la tenían.',
  })
  @ApiCreatedResponse({ type: RoutineDetailResponseDto })
  async assign(
    @CurrentActor() actor: ActorContext,
    @Param() params: RoutineRouteParamsDto,
    @Body() body: AssignRoutineRequestDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const target = buildAssignmentTarget(body);
    const routine = await this.assignRoutine.execute({
      actor,
      routineId: params.routineId,
      // Un cuerpo con las dos cosas o ninguna ya lo rechaza la validación.
      target: target ?? { kind: 'client', membershipId: body.clientMembershipId ?? '' },
    });
    await this.activity.record(actor, { kind: 'routine_assigned', subject: routine.name });
    await this.push.flushCenter(actor);
    return serializeDetail(routine);
  }

  @Delete('routines/:routineId/assignments/:assignmentId')
  @Roles('owner', 'admin', 'staff')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ operationId: 'routines_unassign', summary: 'Quita la asignación de una rutina.' })
  @ApiNoContentResponse()
  async unassign(
    @CurrentActor() actor: ActorContext,
    @Param() params: AssignmentRouteParamsDto,
  ): Promise<void> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    await this.unassignRoutine.execute(actor, params.routineId, params.assignmentId);
  }
}
