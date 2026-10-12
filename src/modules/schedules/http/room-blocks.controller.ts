import {
  Body,
  Controller,
  Delete,
  Get,
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
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentActor } from '../../../shared/auth/decorators/current-actor.decorator';
import { Roles } from '../../../shared/auth/decorators/roles.decorator';
import { ProblemDetailsDto } from '../../../shared/errors/problem-details.dto';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { assertRouteTargetsActorCenter } from '../../../shared/tenancy/assert-route-targets-actor-center';
import { addDaysToLocalDate } from '../../../shared/time/zoned-time';
import { ActivityRecorder } from '../../activity/application/activity-recorder';
import { type RoomBlockView } from '../application/ports/schedule.repository';
import {
  CreateRoomBlockUseCase,
  DeleteRoomBlockUseCase,
  ListRoomBlocksUseCase,
} from '../application/schedule.use-cases';
import {
  BlockRouteParamsDto,
  CenterRouteParamsDto,
  CreateRoomBlockRequestDto,
  RoomBlockListResponseDto,
  RoomBlockResponseDto,
  RoomBlocksQueryDto,
  RoomRouteParamsDto,
} from './schedule.dto';

const UTC_MIDNIGHT_SUFFIX = 'T00:00:00Z';
/** Un día de margen tras la fecha final para cubrir cualquier zona horaria del centro. */
const QUERY_END_MARGIN_DAYS = 2;

function serializeBlock(block: RoomBlockView): Record<string, unknown> {
  return {
    ...block,
    startsAt: block.startsAt.toISOString(),
    endsAt: block.endsAt.toISOString(),
  };
}

/** Las fechas de la consulta (ambas incluidas) como tramo UTC amplio; la hora local la pone la app. */
function toQueryRange(query: RoomBlocksQueryDto): { from: Date; to: Date } {
  return {
    from: new Date(query.from + UTC_MIDNIGHT_SUFFIX),
    to: new Date(addDaysToLocalDate(query.to, QUERY_END_MARGIN_DAYS) + UTC_MIDNIGHT_SUFFIX),
  };
}

/** Bloqueos de sala: alquiler, mantenimiento, evento. */
@ApiTags('rooms')
@ApiBearerAuth('bearer')
@ApiHeader({ name: 'X-Center-Id', required: true })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('centers/:centerId')
export class RoomBlocksController {
  constructor(
    private readonly listBlocks: ListRoomBlocksUseCase,
    private readonly createBlock: CreateRoomBlockUseCase,
    private readonly deleteBlock: DeleteRoomBlockUseCase,
    private readonly activity: ActivityRecorder,
  ) {}

  @Get('room-blocks')
  @Roles('owner', 'admin', 'staff')
  @ApiOperation({
    operationId: 'room_blocks_list',
    summary: 'Los bloqueos de todas las salas entre dos fechas (ambas incluidas).',
  })
  @ApiOkResponse({ type: RoomBlockListResponseDto })
  async listAll(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterRouteParamsDto,
    @Query() query: RoomBlocksQueryDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const blocks = await this.listBlocks.execute(actor, { roomId: null, ...toQueryRange(query) });
    return { blocks: blocks.map(serializeBlock) };
  }

  @Get('rooms/:roomId/blocks')
  @Roles('owner', 'admin', 'staff')
  @ApiOperation({
    operationId: 'room_blocks_list_of_room',
    summary: 'Los bloqueos de una sala entre dos fechas (ambas incluidas).',
  })
  @ApiOkResponse({ type: RoomBlockListResponseDto })
  async listOfRoom(
    @CurrentActor() actor: ActorContext,
    @Param() params: RoomRouteParamsDto,
    @Query() query: RoomBlocksQueryDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const blocks = await this.listBlocks.execute(actor, {
      roomId: params.roomId,
      ...toQueryRange(query),
    });
    return { blocks: blocks.map(serializeBlock) };
  }

  @Post('rooms/:roomId/blocks')
  @Roles('owner', 'admin')
  @ApiOperation({
    operationId: 'room_blocks_create',
    summary:
      'Bloquea la sala en un tramo (alquiler, mantenimiento, evento). Las sesiones de horario sin citas sueltas que caigan dentro se cancelan y se avisa a sus matriculados. 409 ROOM_HAS_BOOKINGS si hay citas sueltas en ese tramo; CONFLICT si se solapa con otro bloqueo.',
  })
  @ApiCreatedResponse({ type: RoomBlockResponseDto })
  async create(
    @CurrentActor() actor: ActorContext,
    @Param() params: RoomRouteParamsDto,
    @Body() body: CreateRoomBlockRequestDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const outcome = await this.createBlock.execute(actor, {
      roomId: params.roomId,
      startsAt: new Date(body.startsAt),
      endsAt: new Date(body.endsAt),
      reason: body.reason,
      note: body.note ?? null,
    });
    await this.activity.record(actor, { kind: 'room_blocked', subject: body.reason });
    return {
      block: serializeBlock(outcome.block),
      cancelledSessionCount: outcome.cancelledSessionCount,
    };
  }

  @Delete('rooms/:roomId/blocks/:blockId')
  @Roles('owner', 'admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    operationId: 'room_blocks_delete',
    summary: 'Quita un bloqueo: la sala vuelve a estar disponible en ese tramo.',
  })
  @ApiNoContentResponse()
  async remove(
    @CurrentActor() actor: ActorContext,
    @Param() params: BlockRouteParamsDto,
  ): Promise<void> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    await this.deleteBlock.execute(actor, { roomId: params.roomId, blockId: params.blockId });
  }
}
