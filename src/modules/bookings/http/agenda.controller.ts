import { Controller, Get, Param, Query } from '@nestjs/common';
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
import { GetDayAgendaUseCase } from '../application/booking.use-cases';
import { AgendaQueryDto, AgendaResponseDto, CenterRouteParamsDto } from './booking.dto';
import { serializeBooking } from './serialize-booking';

@ApiTags('bookings')
@ApiBearerAuth('bearer')
@ApiHeader({ name: 'X-Center-Id', required: true })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('centers/:centerId/agenda')
export class AgendaController {
  constructor(private readonly getDayAgenda: GetDayAgendaUseCase) {}

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
      entries: agenda.entries.map((entry) => ({
        booking: serializeBooking(entry.booking),
        client: entry.client,
      })),
    };
  }
}
