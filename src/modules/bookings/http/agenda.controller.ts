import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiDefaultResponse,
  ApiCreatedResponse,
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
import { CreateBookingUseCase, GetDayAgendaUseCase } from '../application/booking.use-cases';
import { DomainError } from '../../../shared/errors/domain-error';
import { HTTP_STATUS } from '../../../shared/errors/http-status';
import {
  AgendaQueryDto,
  AgendaResponseDto,
  BookingResponseDto,
  CenterRouteParamsDto,
  CreateAgendaBookingRequestDto,
} from './booking.dto';
import { serializeBooking } from './serialize-booking';

@ApiTags('bookings')
@ApiBearerAuth('bearer')
@ApiHeader({ name: 'X-Center-Id', required: true })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('centers/:centerId/agenda')
export class AgendaController {
  constructor(
    private readonly getDayAgenda: GetDayAgendaUseCase,
    private readonly createBooking: CreateBookingUseCase,
  ) {}

  @Get()
  @Roles('owner', 'admin', 'staff')
  @ApiOperation({
    operationId: 'agenda_get_day',
    summary:
      'Citas de un día en la zona horaria del centro, por hora, con las canceladas marcadas por su estado. El personal solo ve su propia agenda; administración ve todas o filtra por persona.',
  })
  @ApiOkResponse({ type: AgendaResponseDto })
  async getDay(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterRouteParamsDto,
    @Query() query: AgendaQueryDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const agenda = await this.getDayAgenda.execute({
      actor,
      date: query.date,
      requestedStaffMembershipId: query.staffMembershipId ?? null,
    });
    return {
      date: query.date,
      timezone: agenda.timeZone,
      openingRanges: agenda.openingRanges,
      entries: agenda.entries.map((entry) => ({
        booking: serializeBooking(entry.booking),
        client: entry.client,
      })),
    };
  }

  @Post('bookings')
  @Roles('owner', 'admin', 'staff')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    operationId: 'agenda_create_booking',
    summary:
      'Crea una cita para un cliente desde la agenda. Mismas reglas de hueco que la reserva del cliente. El personal solo puede ponerla en su propia agenda.',
  })
  @ApiCreatedResponse({ type: BookingResponseDto })
  async createForClient(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterRouteParamsDto,
    @Body() body: CreateAgendaBookingRequestDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    if (
      actor.role === 'staff' &&
      body.staffMembershipId !== undefined &&
      body.staffMembershipId !== actor.membershipId
    ) {
      throw new DomainError('FORBIDDEN', HTTP_STATUS.forbidden);
    }
    const booking = await this.createBooking.execute(actor, {
      serviceId: body.serviceId,
      startsAt: new Date(body.startsAt),
      preferredStaffMembershipId:
        actor.role === 'staff' ? actor.membershipId : (body.staffMembershipId ?? null),
      idempotencyKey: null,
      now: new Date(),
      clientMembershipId: body.clientMembershipId,
    });
    return serializeBooking(booking);
  }
}
