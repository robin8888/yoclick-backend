import { Body, Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiDefaultResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentActor } from '../../../shared/auth/decorators/current-actor.decorator';
import { Roles } from '../../../shared/auth/decorators/roles.decorator';
import { ProblemDetailsDto } from '../../../shared/errors/problem-details.dto';
import { RATE_LIMITS } from '../../../shared/rate-limit/rate-limit-policies';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { assertRouteTargetsActorCenter } from '../../../shared/tenancy/assert-route-targets-actor-center';
import { PushDispatcher } from '../../push/application/push-dispatcher';
import { RescheduleBookingUseCase } from '../application/booking.use-cases';
import {
  BookingResponseDto,
  BookingRouteParamsDto,
  RescheduleBookingRequestDto,
} from './booking.dto';
import { serializeBooking } from './serialize-booking';

@ApiTags('bookings')
@ApiBearerAuth('bearer')
@ApiHeader({ name: 'X-Center-Id', required: true })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('centers/:centerId/bookings')
export class BookingReschedulingController {
  constructor(
    private readonly rescheduleBooking: RescheduleBookingUseCase,
    private readonly push: PushDispatcher,
  ) {}

  @Post(':bookingId/reschedule')
  @Roles('client')
  @Throttle({ default: RATE_LIMITS.createBooking })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'bookings_reschedule',
    summary:
      'Cambia de hora una reserva propia (mismo servicio y, si sigue libre, misma persona). La hora debe coincidir con un hueco de /availability. Pide la misma antelación que cancelar: 409 RESCHEDULE_TOO_LATE si ya no queda. 409 BOOKING_NOT_RESCHEDULABLE si está cancelada, empezada o pasada; SLOT_UNAVAILABLE, OUTSIDE_BOOKING_WINDOW y ALREADY_BOOKED como al reservar. Pedir la hora que ya tiene devuelve la reserva sin cambios.',
  })
  @ApiOkResponse({ type: BookingResponseDto })
  async reschedule(
    @CurrentActor() actor: ActorContext,
    @Param() params: BookingRouteParamsDto,
    @Body() body: RescheduleBookingRequestDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const outcome = await this.rescheduleBooking.execute(actor, {
      bookingId: params.bookingId,
      startsAt: new Date(body.startsAt),
      now: new Date(),
    });
    await this.push.flushCenter(actor);
    return serializeBooking(outcome.booking);
  }
}
