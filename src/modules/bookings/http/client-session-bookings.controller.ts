import { Body, Controller, Headers, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
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
import { parseIdempotencyKeyHeader } from '../../../shared/idempotency/idempotency-key';
import { type JsonValue } from '../../../shared/idempotency/idempotency-store';
import { IdempotencyService } from '../../../shared/idempotency/idempotency.service';
import { RATE_LIMITS } from '../../../shared/rate-limit/rate-limit-policies';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { assertRouteTargetsActorCenter } from '../../../shared/tenancy/assert-route-targets-actor-center';
import { PushDispatcher } from '../../push/application/push-dispatcher';
import {
  JoinGroupSessionUseCase,
  MoveBookingToSessionUseCase,
} from '../application/booking.use-cases';
import {
  BookingResponseDto,
  BookingRouteParamsDto,
  CenterRouteParamsDto,
  JoinOpenSessionRequestDto,
} from './booking.dto';
import { serializeBooking } from './serialize-booking';

/** El cliente se apunta a una clase de un servicio con horario: el centro ya fijó sala y profesor. */
@ApiTags('bookings')
@ApiBearerAuth('bearer')
@ApiHeader({ name: 'X-Center-Id', required: true })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('centers/:centerId/bookings')
export class ClientSessionBookingsController {
  constructor(
    private readonly joinSession: JoinGroupSessionUseCase,
    private readonly moveToSession: MoveBookingToSessionUseCase,
    private readonly idempotency: IdempotencyService,
    private readonly push: PushDispatcher,
  ) {}

  @Post('join-session')
  @Roles('client')
  @Throttle({ default: RATE_LIMITS.createBooking })
  @HttpCode(HttpStatus.CREATED)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'UUID por intención del usuario; los reintentos reutilizan la misma',
  })
  @ApiOperation({
    operationId: 'bookings_join_session',
    summary:
      'El cliente se apunta a una clase con plazas (de `GET /services/:id/open-sessions`). El centro ya decidió sala, profesor y hora. 409 SESSION_FULL si ya no quedan plazas, ALREADY_BOOKED si tiene otra cita a esa hora, OUTSIDE_BOOKING_WINDOW si está fuera de la antelación o la ventana del servicio.',
  })
  @ApiCreatedResponse({ type: BookingResponseDto })
  async join(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterRouteParamsDto,
    @Headers('idempotency-key') idempotencyKeyHeader: string | undefined,
    @Body() body: JoinOpenSessionRequestDto,
  ): Promise<JsonValue> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const outcome = await this.idempotency.execute({
      userId: actor.userId,
      key: parseIdempotencyKeyHeader(idempotencyKeyHeader),
      operation: `POST /v1/centers/${actor.centerId}/bookings/join-session`,
      requestBody: body,
      work: async () => {
        const booking = await this.joinSession.execute(actor, {
          classSessionId: body.classSessionId,
          clientMembershipId: actor.membershipId,
          now: new Date(),
          isClientBooking: true,
        });
        return { status: HttpStatus.CREATED, body: serializeBooking(booking) as JsonValue };
      },
    });
    await this.push.flushCenter(actor);
    return outcome.body;
  }

  @Post(':bookingId/move-to-session')
  @Roles('client')
  @Throttle({ default: RATE_LIMITS.createBooking })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'bookings_move_to_session',
    summary:
      'El cliente pasa su reserva a otra clase con plazas del mismo servicio. La plaza de la clase anterior queda libre y se avisa al profesor y al centro. Pide la misma antelación que cancelar: 409 RESCHEDULE_TOO_LATE; BOOKING_NOT_RESCHEDULABLE si está cancelada, empezada o pasada; SESSION_FULL, ALREADY_BOOKED y SLOT_UNAVAILABLE si la clase no sirve. Pedir la clase que ya tiene la deja como está.',
  })
  @ApiOkResponse({ type: BookingResponseDto })
  async move(
    @CurrentActor() actor: ActorContext,
    @Param() params: BookingRouteParamsDto,
    @Body() body: JoinOpenSessionRequestDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const outcome = await this.moveToSession.execute(actor, {
      bookingId: params.bookingId,
      classSessionId: body.classSessionId,
      now: new Date(),
    });
    await this.push.flushCenter(actor);
    return serializeBooking(outcome.booking);
  }
}
