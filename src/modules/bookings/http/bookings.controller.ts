import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
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
import {
  CancelBookingUseCase,
  CreateBookingUseCase,
  ListMyBookingsUseCase,
} from '../application/booking.use-cases';
import { PushDispatcher } from '../../push/application/push-dispatcher';
import { type CreateBookingCommand } from '../application/ports/booking.repository';
import {
  BookingResponseDto,
  BookingRouteParamsDto,
  CancelBookingResponseDto,
  CenterRouteParamsDto,
  CreateBookingRequestDto,
  MyBookingsQueryDto,
  MyBookingsResponseDto,
} from './booking.dto';
import { serializeBooking } from './serialize-booking';

function toCreateBookingCommand(
  body: CreateBookingRequestDto,
  idempotencyKey: string,
): CreateBookingCommand {
  return {
    serviceId: body.serviceId,
    startsAt: new Date(body.startsAt),
    preferredStaffMembershipId: body.staffMembershipId ?? null,
    idempotencyKey,
    now: new Date(),
  };
}

@ApiTags('bookings')
@ApiBearerAuth('bearer')
@ApiHeader({ name: 'X-Center-Id', required: true })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('centers/:centerId/bookings')
export class BookingsController {
  constructor(
    private readonly createBooking: CreateBookingUseCase,
    private readonly listMyBookings: ListMyBookingsUseCase,
    private readonly cancelBooking: CancelBookingUseCase,
    private readonly idempotency: IdempotencyService,
    private readonly push: PushDispatcher,
  ) {}

  @Post()
  @Roles('client')
  @Throttle({ default: RATE_LIMITS.createBooking })
  @HttpCode(HttpStatus.CREATED)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'UUID por intención del usuario; los reintentos reutilizan la misma',
  })
  @ApiOperation({
    operationId: 'bookings_create',
    summary:
      'Reserva un hueco individual. La hora debe coincidir con un hueco de /availability: 409 SLOT_UNAVAILABLE si ya no está, OUTSIDE_BOOKING_WINDOW si es demasiado pronto o lejos, ALREADY_BOOKED si ya tienes otra cita a esa hora. Repetir la misma Idempotency-Key devuelve la misma reserva.',
  })
  @ApiCreatedResponse({ type: BookingResponseDto })
  async create(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterRouteParamsDto,
    @Headers('idempotency-key') idempotencyKeyHeader: string | undefined,
    @Body() body: CreateBookingRequestDto,
  ): Promise<JsonValue> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const idempotencyKey = parseIdempotencyKeyHeader(idempotencyKeyHeader);
    const outcome = await this.idempotency.execute({
      userId: actor.userId,
      key: idempotencyKey,
      operation: `POST /v1/centers/${actor.centerId}/bookings`,
      requestBody: body,
      work: async () => {
        const booking = await this.createBooking.execute(
          actor,
          toCreateBookingCommand(body, idempotencyKey),
        );
        return { status: HttpStatus.CREATED, body: serializeBooking(booking) as JsonValue };
      },
    });
    // Tras confirmarse la reserva (también si es un reintento: el envío es idempotente).
    await this.push.flushCenter(actor);
    return outcome.body;
  }

  @Get('mine')
  @Roles('client')
  @ApiOperation({
    operationId: 'bookings_list_mine',
    summary:
      'Mis reservas. «upcoming»: no canceladas que aún no han terminado, de la más próxima a la más lejana. «past»: el resto, de la más reciente a la más antigua.',
  })
  @ApiOkResponse({ type: MyBookingsResponseDto })
  async listMine(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterRouteParamsDto,
    @Query() query: MyBookingsQueryDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const bookings = await this.listMyBookings.execute({
      actor,
      scope: query.scope,
      limit: query.limit,
      now: new Date(),
    });
    return { bookings: bookings.map(serializeBooking) };
  }

  @Post(':bookingId/cancel')
  @Roles('client')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'bookings_cancel',
    summary:
      'Cancela una reserva propia. Se puede cancelar fuera de plazo (withinPolicy=false). Cancelar una ya cancelada devuelve el mismo resultado; una que ya empezó, 409 BOOKING_NOT_CANCELLABLE.',
  })
  @ApiOkResponse({ type: CancelBookingResponseDto })
  async cancel(
    @CurrentActor() actor: ActorContext,
    @Param() params: BookingRouteParamsDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const result = await this.cancelBooking.execute({
      actor,
      bookingId: params.bookingId,
      now: new Date(),
    });
    await this.push.flushCenter(actor);
    return { booking: serializeBooking(result.booking), withinPolicy: result.withinPolicy };
  }
}
