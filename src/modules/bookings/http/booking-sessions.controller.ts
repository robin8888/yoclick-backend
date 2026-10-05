import { Body, Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
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
import { EndSessionUseCase, StartSessionUseCase } from '../application/session-record.use-cases';
import { BookingResponseDto, BookingRouteParamsDto } from './booking.dto';
import { serializeBooking } from './serialize-booking';
import { EndSessionRequestDto } from './session-record.dto';

/** Registro de la clase con temporizador: lo inicia y termina quien la atiende, el servidor guarda las horas. */
@ApiTags('bookings')
@ApiBearerAuth('bearer')
@ApiHeader({ name: 'X-Center-Id', required: true })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('centers/:centerId/bookings')
export class BookingSessionsController {
  constructor(
    private readonly startSession: StartSessionUseCase,
    private readonly endSession: EndSessionUseCase,
  ) {}

  @Post(':bookingId/start')
  @Roles('owner', 'admin', 'staff')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'bookings_start',
    summary:
      'Inicia la clase: el servidor guarda startedAt y la app calcula el temporizador a partir de él. Quien atiende la reserva (o administración); para el resto, 404. Solo reservas confirmadas, desde 15 minutos antes hasta que termina (409 BOOKING_NOT_STARTABLE); 409 SESSION_ALREADY_OPEN si esa persona ya tiene otra clase en marcha. Repetirla devuelve la misma reserva.',
  })
  @ApiOkResponse({ type: BookingResponseDto })
  async start(
    @CurrentActor() actor: ActorContext,
    @Param() params: BookingRouteParamsDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const booking = await this.startSession.execute({
      actor,
      bookingId: params.bookingId,
      now: new Date(),
    });
    return serializeBooking(booking);
  }

  @Post(':bookingId/end')
  @Roles('owner', 'admin', 'staff')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'bookings_end',
    summary:
      'Termina la clase: guarda endedAt, la duración real y pasa la reserva a attended. Notas opcionales (hasta 500 caracteres). Mismas reglas de quién que iniciar; 409 SESSION_NOT_STARTED si no estaba iniciada. Sin límite de tiempo para cerrarla; cerrar una ya cerrada devuelve lo mismo.',
  })
  @ApiBody({ type: EndSessionRequestDto, required: false })
  @ApiOkResponse({ type: BookingResponseDto })
  async end(
    @CurrentActor() actor: ActorContext,
    @Param() params: BookingRouteParamsDto,
    @Body() body: EndSessionRequestDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const booking = await this.endSession.execute({
      actor,
      bookingId: params.bookingId,
      notes: body.notes ? body.notes : null,
      now: new Date(),
    });
    return serializeBooking(booking);
  }
}
