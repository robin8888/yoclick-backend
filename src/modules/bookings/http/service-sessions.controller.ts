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
import { ListServiceSessionsUseCase } from '../application/booking.use-cases';
import {
  ServiceSessionsQueryDto,
  ServiceSessionsResponseDto,
  ServiceSessionsRouteParamsDto,
} from './booking.dto';

/** Las clases de un servicio con plazas: lo que se ofrece al poner una cita. */
@ApiTags('bookings')
@ApiBearerAuth('bearer')
@ApiHeader({ name: 'X-Center-Id', required: true })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('centers/:centerId/services/:serviceId/open-sessions')
export class ServiceSessionsController {
  constructor(private readonly listServiceSessions: ListServiceSessionsUseCase) {}

  @Get()
  @Roles('owner', 'admin', 'staff', 'client')
  @ApiOperation({
    operationId: 'services_list_open_sessions',
    summary:
      'Las clases futuras de un servicio con plazas libres entre dos fechas (sala, profesor, hora y plazas), si el servicio tiene horario de sala vigente (`isScheduled`) y la próxima clase con plazas aunque caiga fuera del rango.',
  })
  @ApiOkResponse({ type: ServiceSessionsResponseDto })
  async list(
    @CurrentActor() actor: ActorContext,
    @Param() params: ServiceSessionsRouteParamsDto,
    @Query() query: ServiceSessionsQueryDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const view = await this.listServiceSessions.execute(actor, {
      serviceId: params.serviceId,
      fromDate: query.from,
      toDate: query.to,
      now: new Date(),
      shouldIncludeFull: query.includeFull === 'true',
    });
    return {
      timezone: view.timeZone,
      isScheduled: view.isScheduled,
      sessions: view.sessions.map((session) => ({
        ...session,
        startsAt: session.startsAt.toISOString(),
        endsAt: session.endsAt.toISOString(),
      })),
      nextOpenStartsAt: view.nextOpenStartsAt?.toISOString() ?? null,
    };
  }
}
