import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
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
import { AllowStaffWithPermission } from '../../../shared/auth/decorators/staff-permission.decorator';
import { ProblemDetailsDto } from '../../../shared/errors/problem-details.dto';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { assertRouteTargetsActorCenter } from '../../../shared/tenancy/assert-route-targets-actor-center';
import {
  ArchiveRoomUseCase,
  CreateRoomUseCase,
  ListRoomsUseCase,
} from '../application/room.use-cases';
import {
  CenterRouteParamsDto,
  CreateRoomRequestDto,
  RoomListResponseDto,
  RoomResponseDto,
  RoomRouteParamsDto,
} from './room.dto';
import { ActivityRecorder } from '../../activity/application/activity-recorder';

@ApiTags('rooms')
@ApiBearerAuth('bearer')
@ApiHeader({ name: 'X-Center-Id', required: true })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('centers/:centerId/rooms')
export class RoomsController {
  constructor(
    private readonly listRooms: ListRoomsUseCase,
    private readonly createRoom: CreateRoomUseCase,
    private readonly archiveRoom: ArchiveRoomUseCase,
    private readonly activity: ActivityRecorder,
  ) {}

  @Get()
  @Roles('owner', 'admin', 'staff')
  @ApiOperation({
    operationId: 'rooms_list',
    summary: 'Salas y recursos del centro (no archivados), por orden de creación.',
  })
  @ApiOkResponse({ type: RoomListResponseDto })
  async list(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterRouteParamsDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    return { rooms: await this.listRooms.execute(actor) };
  }

  @Post()
  @Roles('owner', 'admin')
  @AllowStaffWithPermission('services:manage')
  @ApiOperation({
    operationId: 'rooms_create',
    summary:
      'Añade una sala o recurso con su aforo máximo. 409 si ya hay una activa con ese nombre.',
  })
  @ApiCreatedResponse({ type: RoomResponseDto })
  async create(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterRouteParamsDto,
    @Body() body: CreateRoomRequestDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const room = await this.createRoom.execute(actor, body);
    await this.activity.record(actor, { kind: 'room_created', subject: room.name });
    return { ...room };
  }

  @Delete(':roomId')
  @Roles('owner', 'admin')
  @AllowStaffWithPermission('services:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    operationId: 'rooms_archive',
    summary: 'Quita la sala: deja de ofrecerse y los servicios que la usaban quedan sin sala fija.',
  })
  @ApiNoContentResponse()
  async archive(
    @CurrentActor() actor: ActorContext,
    @Param() params: RoomRouteParamsDto,
  ): Promise<void> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    await this.archiveRoom.execute(actor, params.roomId);
    await this.activity.record(actor, { kind: 'room_archived' });
  }
}
