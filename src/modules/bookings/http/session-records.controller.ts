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
import { ListSessionRecordsUseCase } from '../application/session-record.use-cases';
import { CenterRouteParamsDto } from './booking.dto';
import { serializeBooking } from './serialize-booking';
import { SessionRecordsQueryDto, SessionRecordsResponseDto } from './session-record.dto';

@ApiTags('bookings')
@ApiBearerAuth('bearer')
@ApiHeader({ name: 'X-Center-Id', required: true })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('centers/:centerId/session-records')
export class SessionRecordsController {
  constructor(private readonly listSessionRecords: ListSessionRecordsUseCase) {}

  @Get()
  @Roles('owner', 'admin')
  @ApiOperation({
    operationId: 'session_records_list',
    summary:
      'Registro de clases de un rango de días (máximo 31, en la zona del centro): las iniciadas con su duración real y las que ya pasaron de hora sin iniciarse (startedAt null). Incluye totales por profesional. Solo propiedad y administración, con segundo factor.',
  })
  @ApiOkResponse({ type: SessionRecordsResponseDto })
  async list(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterRouteParamsDto,
    @Query() query: SessionRecordsQueryDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const report = await this.listSessionRecords.execute({
      actor,
      query: {
        fromDate: query.from,
        toDate: query.to,
        staffMembershipId: query.staffMembershipId ?? null,
        now: new Date(),
      },
    });
    return {
      timezone: report.timeZone,
      records: report.records.map((record) => ({
        booking: serializeBooking(record.booking),
        client: record.client,
        staff: record.booking.staff,
        plannedDurationSeconds: record.plannedDurationSeconds,
        actualDurationSeconds: record.actualDurationSeconds,
        isOpen: record.isOpen,
        notes: record.notes,
      })),
      totals: report.totals,
    };
  }
}
