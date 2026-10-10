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
import { PushDispatcher } from '../../push/application/push-dispatcher';
import { RescheduleBookingByTeamUseCase } from '../application/booking.use-cases';
import {
  BookingResponseDto,
  BookingRouteParamsDto,
  RescheduleAgendaBookingRequestDto,
} from './booking.dto';
import { serializeBooking } from './serialize-booking';

/** Quien mueve la cita desde la agenda puede elegir cualquier cuarto de hora, como al crearla. */
const AGENDA_SLOT_STEP_MINUTES = 15;

@ApiTags('bookings')
@ApiBearerAuth('bearer')
@ApiHeader({ name: 'X-Center-Id', required: true })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('centers/:centerId/agenda')
export class AgendaReschedulingController {
  constructor(
    private readonly rescheduleBookingByTeam: RescheduleBookingByTeamUseCase,
    private readonly activity: ActivityRecorder,
    private readonly push: PushDispatcher,
  ) {}

  @Post('bookings/:bookingId/reschedule')
  @Roles('owner', 'admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'agenda_reschedule_booking',
    summary:
      'Mueve una cita futura a otra hora desde la agenda, con el mismo servicio. Solo el centro (propietario o administración) mueve citas; el personal puede cancelarlas pero no moverlas. Sin antelación mínima. El cliente recibe un aviso push. Una cancelada, empezada o pasada responde 409 BOOKING_NOT_RESCHEDULABLE.',
  })
  @ApiOkResponse({ type: BookingResponseDto })
  async rescheduleForClient(
    @CurrentActor() actor: ActorContext,
    @Param() params: BookingRouteParamsDto,
    @Body() body: RescheduleAgendaBookingRequestDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const outcome = await this.rescheduleBookingByTeam.execute(actor, {
      bookingId: params.bookingId,
      startsAt: new Date(body.startsAt),
      now: new Date(),
      preferredStaffMembershipId: body.staffMembershipId,
      slotStepMinutes: AGENDA_SLOT_STEP_MINUTES,
    });
    if (outcome.hasChangedTime) {
      await this.activity.record(actor, {
        kind: 'booking_rescheduled_by_team',
        subject: outcome.booking.service.name,
      });
      await this.push.flushCenter(actor);
    }
    return serializeBooking(outcome.booking);
  }
}
