import { Body, Controller, Param, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiDefaultResponse,
  ApiHeader,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentActor } from '../../../shared/auth/decorators/current-actor.decorator';
import { Roles } from '../../../shared/auth/decorators/roles.decorator';
import { ProblemDetailsDto } from '../../../shared/errors/problem-details.dto';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { assertRouteTargetsActorCenter } from '../../../shared/tenancy/assert-route-targets-actor-center';
import { BroadcastToGroupUseCase } from '../application/chat.use-cases';
import {
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
  constructor(private readonly broadcastToGroup: BroadcastToGroupUseCase) {}

  @Post()
  @Roles('owner', 'admin')
  @ApiOperation({
    operationId: 'chat_broadcast_to_group',
    summary:
      'La administración escribe a todas las personas de un grupo; cada una lo recibe en su conversación con el centro y las respuestas vuelven por separado. Los menores no reciben. 404 si el grupo no existe.',
  })
  @ApiCreatedResponse({ type: GroupBroadcastResponseDto })
  async broadcast(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterRouteParamsDto,
    @Body() body: GroupBroadcastRequestDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const outcome = await this.broadcastToGroup.execute(actor, {
      groupId: body.groupId,
      body: body.body,
    });
    return { sentCount: outcome.sentCount, skippedMinorCount: outcome.skippedMinorCount };
  }
}
