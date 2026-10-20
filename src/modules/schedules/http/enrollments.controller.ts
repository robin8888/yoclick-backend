import { RequiresModule } from '../../../shared/auth/decorators/requires-module.decorator';
import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
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
import { type EnrollmentView } from '../application/ports/schedule.repository';
import {
  EnrollClientsUseCase,
  ListEnrollmentsUseCase,
  UnenrollClientUseCase,
} from '../application/schedule.use-cases';
import {
  EnrollmentListResponseDto,
  EnrollmentRouteParamsDto,
  EnrollRequestDto,
  EnrollResponseDto,
  SeriesRouteParamsDto,
  UnenrollResponseDto,
} from './schedule.dto';

function serializeEnrollment(enrollment: EnrollmentView): Record<string, unknown> {
  return { ...enrollment, createdAt: enrollment.createdAt.toISOString() };
}

/** Grupos fijos: quién está matriculado en un horario. */
@ApiTags('schedules')
@ApiBearerAuth('bearer')
@ApiHeader({ name: 'X-Center-Id', required: true })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@RequiresModule('rooms')
@Controller('centers/:centerId/schedules/:seriesId/enrollments')
export class EnrollmentsController {
  constructor(
    private readonly listEnrollments: ListEnrollmentsUseCase,
    private readonly enrollClients: EnrollClientsUseCase,
    private readonly unenrollClient: UnenrollClientUseCase,
    private readonly activity: ActivityRecorder,
  ) {}

  @Get()
  @Roles('owner', 'admin', 'staff')
  @ApiOperation({
    operationId: 'schedules_list_enrollments',
    summary: 'Las personas matriculadas (activas) en un horario, por nombre.',
  })
  @ApiOkResponse({ type: EnrollmentListResponseDto })
  async list(
    @CurrentActor() actor: ActorContext,
    @Param() params: SeriesRouteParamsDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const enrollments = await this.listEnrollments.execute(actor, params.seriesId);
    return { enrollments: enrollments.map(serializeEnrollment) };
  }

  @Post()
  @Roles('owner', 'admin')
  @ApiOperation({
    operationId: 'schedules_enroll',
    summary:
      'Matricula a varias personas en el horario: tendrán plaza en todas sus sesiones futuras sin reservar nada (y sin gastar bono). Quien ya tiene otra cita un día concreto se salta ese día. Las que no caben o ya estaban salen en `skipped`.',
  })
  @ApiCreatedResponse({ type: EnrollResponseDto })
  async enroll(
    @CurrentActor() actor: ActorContext,
    @Param() params: SeriesRouteParamsDto,
    @Body() body: EnrollRequestDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const outcome = await this.enrollClients.execute(actor, {
      seriesId: params.seriesId,
      clientMembershipIds: body.clientMembershipIds,
      startsOn: body.startsOn ?? null,
      endsOn: body.endsOn ?? null,
    });
    if (outcome.enrollments.length > 0) {
      await this.activity.record(actor, {
        kind: 'schedule_enrolled',
        subject: String(outcome.enrollments.length),
      });
    }
    return {
      enrollments: outcome.enrollments.map(serializeEnrollment),
      skipped: outcome.skipped,
      skippedDates: outcome.skippedDates,
    };
  }

  @Delete(':enrollmentId')
  @Roles('owner', 'admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'schedules_unenroll',
    summary:
      'Da de baja a una persona del horario: se cancelan sus plazas futuras (sin gastar bono) y se le avisa.',
  })
  @ApiOkResponse({ type: UnenrollResponseDto })
  async unenroll(
    @CurrentActor() actor: ActorContext,
    @Param() params: EnrollmentRouteParamsDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const outcome = await this.unenrollClient.execute(actor, {
      seriesId: params.seriesId,
      enrollmentId: params.enrollmentId,
    });
    await this.activity.record(actor, { kind: 'schedule_unenrolled' });
    return { cancelledBookingCount: outcome.cancelledBookingCount };
  }
}
