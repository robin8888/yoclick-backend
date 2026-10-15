import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
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
import {
  BroadcastToGroupUseCase,
  ListBroadcastTargetsUseCase,
} from '../application/chat.use-cases';
import {
  BroadcastTargetsResponseDto,
  CenterRouteParamsDto,
  GroupBroadcastRequestDto,
  GroupBroadcastResponseDto,
} from './chat.dto';

@ApiTags('chat')
@ApiBearerAuth('bearer')
@ApiHeader({ name: 'X-Center-Id', required: true })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('centers/:centerId/conversations/broadcast')
export class GroupBroadcastController {
  constructor(
    private readonly broadcastToGroup: BroadcastToGroupUseCase,
    private readonly listTargets: ListBroadcastTargetsUseCase,
  ) {}

  @Get('targets')
  @Roles('owner', 'admin', 'staff')
  @ApiOperation({
    operationId: 'chat_list_broadcast_targets',
    summary:
      'A qué grupos de clientes y clases fijas puede escribir quien pregunta: todos la administración, solo los suyos un profesor.',
  })
  @ApiOkResponse({ type: BroadcastTargetsResponseDto })
  async targets(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterRouteParamsDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const targets = await this.listTargets.execute(actor);
    return { groups: [...targets.groups], classes: [...targets.classes] };
  }

  @Post()
  @Roles('owner', 'admin', 'staff')
  @ApiOperation({
    operationId: 'chat_broadcast_to_group',
    summary:
      'Escribe a todas las personas de un grupo de clientes (`groupId`) o de una clase fija (`seriesId`). La administración lo hace en nombre del centro; un profesor, en persona y solo a lo suyo. Cada una lo recibe en su conversación y las respuestas vuelven por separado. Los menores no reciben. 404 si no existe o no es suyo.',
  })
  @ApiCreatedResponse({ type: GroupBroadcastResponseDto })
  async broadcast(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterRouteParamsDto,
    @Body() body: GroupBroadcastRequestDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const target =
      body.groupId === undefined
        ? ({ kind: 'series', seriesId: body.seriesId ?? '' } as const)
        : ({ kind: 'group', groupId: body.groupId } as const);
    const outcome = await this.broadcastToGroup.execute(actor, { target, body: body.body });
    return { sentCount: outcome.sentCount, skippedMinorCount: outcome.skippedMinorCount };
  }
}
