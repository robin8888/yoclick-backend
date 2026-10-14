import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiDefaultResponse,
  ApiHeader,
  ApiNoContentResponse,
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
import {
  CreateTimeEntryUseCase,
  DeleteTimeEntryUseCase,
  ListTimeEntriesUseCase,
  UpdateTimeEntryUseCase,
} from '../application/time-entry.use-cases';
import { serializeTimeEntry } from './serialize-time-entry';
import {
  CenterRouteParamsDto,
  CreateTimeEntryRequestDto,
  TimeEntryListQueryDto,
  TimeEntryListResponseDto,
  TimeEntryResponseDto,
  TimeEntryRouteParamsDto,
  UpdateTimeEntryRequestDto,
} from './time-entry.dto';

/** Fichaje del equipo: cada persona ve y corrige sus horas; administración, las de todo el centro. */
@ApiTags('time-entries')
@ApiBearerAuth('bearer')
@ApiHeader({ name: 'X-Center-Id', required: true })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('centers/:centerId/me/time-entries')
export class TimeEntriesController {
  constructor(
    private readonly listTimeEntries: ListTimeEntriesUseCase,
    private readonly createTimeEntry: CreateTimeEntryUseCase,
    private readonly updateTimeEntry: UpdateTimeEntryUseCase,
    private readonly deleteTimeEntry: DeleteTimeEntryUseCase,
  ) {}

  @Get()
  @Roles('owner', 'admin', 'staff')
  @Throttle({ default: RATE_LIMITS.manageTimeEntries })
  @ApiOperation({
    operationId: 'time_entries_list',
    summary:
      'Los turnos de un mes (por fecha de trabajo) de quien pregunta, con totales de minutos, días y turnos corregidos. Con staffMembershipId, owner/admin ven a otra persona del equipo; el personal recibe 403.',
  })
  @ApiOkResponse({ type: TimeEntryListResponseDto })
  async list(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterRouteParamsDto,
    @Query() query: TimeEntryListQueryDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const month = await this.listTimeEntries.execute(actor, query);
    return {
      month: month.month,
      staffMembershipId: month.staffMembershipId,
      entries: month.entries.map(serializeTimeEntry),
      totals: month.totals,
    };
  }

  @Post()
  @Roles('owner', 'admin', 'staff')
  @Throttle({ default: RATE_LIMITS.manageTimeEntries })
  @ApiOperation({
    operationId: 'time_entries_create',
    summary:
      'Da de alta a mano un turno olvidado (entrada y salida). 422 si la salida no es posterior, dura más de 16 horas o está en el futuro; 409 TIME_ENTRY_OVERLAP si se solapa con otro turno.',
  })
  @ApiCreatedResponse({ type: TimeEntryResponseDto })
  async create(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterRouteParamsDto,
    @Body() body: CreateTimeEntryRequestDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const entry = await this.createTimeEntry.execute(actor, {
      clockInAt: new Date(body.clockInAt),
      clockOutAt: new Date(body.clockOutAt),
      now: new Date(),
    });
    return serializeTimeEntry(entry);
  }

  @Patch(':entryId')
  @Roles('owner', 'admin', 'staff')
  @Throttle({ default: RATE_LIMITS.manageTimeEntries })
  @ApiOperation({
    operationId: 'time_entries_update',
    summary:
      'Corrige la entrada y/o la salida de un turno. Se aplica al instante y queda marcado como corregido con las horas originales. El personal solo las suyas; owner/admin, las de cualquiera. Poner salida a un turno abierto lo cierra.',
  })
  @ApiOkResponse({ type: TimeEntryResponseDto })
  async update(
    @CurrentActor() actor: ActorContext,
    @Param() params: TimeEntryRouteParamsDto,
    @Body() body: UpdateTimeEntryRequestDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const entry = await this.updateTimeEntry.execute(actor, {
      entryId: params.entryId,
      clockInAt: body.clockInAt === undefined ? undefined : new Date(body.clockInAt),
      clockOutAt: body.clockOutAt === undefined ? undefined : new Date(body.clockOutAt),
      now: new Date(),
    });
    return serializeTimeEntry(entry);
  }

  @Delete(':entryId')
  @Roles('owner', 'admin', 'staff')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: RATE_LIMITS.manageTimeEntries })
  @ApiOperation({
    operationId: 'time_entries_delete',
    summary:
      'Borra un turno (borrado lógico, p. ej. por duplicado). Mismas reglas de propiedad que editar.',
  })
  @ApiNoContentResponse()
  async remove(
    @CurrentActor() actor: ActorContext,
    @Param() params: TimeEntryRouteParamsDto,
  ): Promise<void> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    await this.deleteTimeEntry.execute(actor, { entryId: params.entryId, now: new Date() });
  }
}
