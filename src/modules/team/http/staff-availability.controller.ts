import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
} from '@nestjs/common';
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
import { PushDispatcher } from '../../push/application/push-dispatcher';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { assertRouteTargetsActorCenter } from '../../../shared/tenancy/assert-route-targets-actor-center';
import {
  AddStaffAbsenceUseCase,
  GetStaffAvailabilityUseCase,
  RemoveStaffAbsenceUseCase,
  SaveStaffWeeklyHoursUseCase,
} from '../application/staff-availability.use-cases';
import {
  AbsenceRouteParamsDto,
  AddedStaffAbsenceResponseDto,
  AddStaffAbsenceRequestDto,
  AvailabilityRouteParamsDto,
  SaveStaffWeeklyHoursRequestDto,
  StaffAvailabilityResponseDto,
} from './staff-availability.dto';

/** Horario propio y ausencias de una persona del equipo: la administración, de todas; el personal, de sí misma. */
@ApiTags('team')
@ApiBearerAuth('bearer')
@ApiHeader({ name: 'X-Center-Id', required: true })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('centers/:centerId/team/:membershipId')
@Roles('owner', 'admin', 'staff')
export class StaffAvailabilityController {
  constructor(
    private readonly getAvailability: GetStaffAvailabilityUseCase,
    private readonly saveWeeklyHours: SaveStaffWeeklyHoursUseCase,
    private readonly addAbsence: AddStaffAbsenceUseCase,
    private readonly removeAbsence: RemoveStaffAbsenceUseCase,
    private readonly push: PushDispatcher,
  ) {}

  @Get('availability')
  @ApiOperation({
    operationId: 'team_get_availability',
    summary: 'Horario propio y ausencias de una persona del equipo.',
  })
  @ApiOkResponse({ type: StaffAvailabilityResponseDto })
  async get(
    @CurrentActor() actor: ActorContext,
    @Param() params: AvailabilityRouteParamsDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    return { ...(await this.getAvailability.execute(actor, params.membershipId)) };
  }

  @Put('availability')
  @ApiOperation({
    operationId: 'team_save_availability',
    summary:
      'Guarda el horario semanal propio. Solo se puede reservar con la persona dentro de esos tramos y del horario del centro. `null` vuelve al horario del centro.',
  })
  @ApiOkResponse({ type: StaffAvailabilityResponseDto })
  async save(
    @CurrentActor() actor: ActorContext,
    @Param() params: AvailabilityRouteParamsDto,
    @Body() body: SaveStaffWeeklyHoursRequestDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    return {
      ...(await this.saveWeeklyHours.execute({
        actor,
        membershipId: params.membershipId,
        weeklyHours: body.weeklyHours,
      })),
    };
  }

  @Post('absences')
  @ApiOperation({
    operationId: 'team_add_absence',
    summary:
      'Añade unos días de ausencia (vacaciones, formación…). No se pueden reservar citas con la persona esos días; las que ya había se cuentan en la respuesta para que el centro las reasigne.',
  })
  @ApiCreatedResponse({ type: AddedStaffAbsenceResponseDto })
  async add(
    @CurrentActor() actor: ActorContext,
    @Param() params: AvailabilityRouteParamsDto,
    @Body() body: AddStaffAbsenceRequestDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const added = await this.addAbsence.execute({
      actor,
      membershipId: params.membershipId,
      startsOn: body.startsOn,
      endsOn: body.endsOn,
      reason: body.reason,
    });
    await this.push.flushCenter(actor);
    return { ...added };
  }

  @Delete('absences/:absenceId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ operationId: 'team_remove_absence', summary: 'Quita una ausencia.' })
  @ApiNoContentResponse()
  async remove(
    @CurrentActor() actor: ActorContext,
    @Param() params: AbsenceRouteParamsDto,
  ): Promise<void> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    await this.removeAbsence.execute(actor, params.membershipId, params.absenceId);
  }
}
