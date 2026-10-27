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
import { GetRoomAgendaUseCase } from '../application/booking.use-cases';
import { CenterRouteParamsDto, RoomAgendaQueryDto, RoomAgendaResponseDto } from './booking.dto';

/** La agenda del centro vista por sala. */
@ApiTags('bookings')
@ApiBearerAuth('bearer')
@ApiHeader({ name: 'X-Center-Id', required: true })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('centers/:centerId/agenda')
export class AgendaRoomsController {
  constructor(private readonly getRoomAgenda: GetRoomAgendaUseCase) {}

  @Get('rooms')
  @Roles('owner', 'admin')
  @ApiOperation({
    operationId: 'agenda_get_room_day',
    summary:
      'La agenda del centro por sala: cada sala con su aforo, su profesor y lo que la ocupa ese día (clase, profesor, de qué hora a qué hora, plazas y alumnos apuntados). Las citas sin sala salen aparte.',
  })
  @ApiOkResponse({ type: RoomAgendaResponseDto })
  async getRoomsOfDay(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterRouteParamsDto,
    @Query() query: RoomAgendaQueryDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const agenda = await this.getRoomAgenda.execute(actor, { date: query.date });
    const serialize = <
      TRange extends { startsAt: Date; endsAt: Date; startedAt: Date | null; endedAt: Date | null },
    >(
      range: TRange,
    ) => ({
      ...range,
      startsAt: range.startsAt.toISOString(),
      endsAt: range.endsAt.toISOString(),
      startedAt: range.startedAt?.toISOString() ?? null,
      endedAt: range.endedAt?.toISOString() ?? null,
    });
    return {
      date: query.date,
      timezone: agenda.timeZone,
      openingRanges: agenda.openingRanges,
      rooms: agenda.rooms.map((room) => ({
        ...room,
        sessions: room.sessions.map(serialize),
      })),
      sessionsWithoutRoom: agenda.sessionsWithoutRoom.map(serialize),
    };
  }
}
