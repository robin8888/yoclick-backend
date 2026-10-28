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
import { ProblemDetailsDto } from '../../../shared/errors/problem-details.dto';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { assertRouteTargetsActorCenter } from '../../../shared/tenancy/assert-route-targets-actor-center';
import { ChatPresenter } from '../application/chat-presenter';
import {
  BlockPersonUseCase,
  ListBlockedPeopleUseCase,
  UnblockPersonUseCase,
} from '../application/chat-moderation.use-cases';
import { CenterRouteParamsDto } from './chat.dto';
import {
  BlockedPeopleResponseDto,
  BlockedPersonResponseDto,
  BlockPersonRequestDto,
  ChatBlockRouteParamsDto,
} from './chat-moderation.dto';

/**
 * Bloquear a una persona en el chat (Apple 1.2). Solo entre alumno y profesor: la administración habla en
 * nombre del centro y no bloquea ni se la bloquea. Quien bloquea deja de ver esa conversación, no recibe
 * avisos suyos y no le aparece como contacto; la persona bloqueada no puede escribirle ni abrir conversación
 * con ella, y recibe el mismo error de siempre: nunca se le dice que la han bloqueado.
 */
@ApiTags('chat')
@ApiBearerAuth('bearer')
@ApiHeader({ name: 'X-Center-Id', required: true })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('centers/:centerId/chat-blocks')
export class ChatBlocksController {
  constructor(
    private readonly listBlocked: ListBlockedPeopleUseCase,
    private readonly blockPerson: BlockPersonUseCase,
    private readonly unblockPerson: UnblockPersonUseCase,
    private readonly presenter: ChatPresenter,
  ) {}

  @Get()
  @Roles('staff', 'client')
  @ApiOperation({
    operationId: 'chat_list_blocks',
    summary:
      'Las personas a las que has bloqueado en el chat de este centro, de la más reciente a la más antigua.',
  })
  @ApiOkResponse({ type: BlockedPeopleResponseDto })
  async list(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterRouteParamsDto,
  ): Promise<{ blocks: Record<string, unknown>[] }> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const blocks = await this.listBlocked.execute(actor);
    return { blocks: blocks.map((block) => this.presenter.blockedPerson(block)) };
  }

  @Post()
  @Roles('staff', 'client')
  @ApiOperation({
    operationId: 'chat_block_person',
    summary:
      'Bloquea a una persona (un alumno si eres profesor, un profesor si eres alumno). Bloquear a quien ya está bloqueado no falla. 404 si no existe; 403 CHAT_BLOCK_NOT_ALLOWED si eres tú, la administración o alguien de tu mismo rol.',
  })
  @ApiCreatedResponse({ type: BlockedPersonResponseDto })
  async block(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterRouteParamsDto,
    @Body() body: BlockPersonRequestDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    return this.presenter.blockedPerson(
      await this.blockPerson.execute(actor, body.blockedMembershipId),
    );
  }

  @Delete(':blockedMembershipId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles('staff', 'client')
  @ApiOperation({
    operationId: 'chat_unblock_person',
    summary: 'Quita el bloqueo a una persona. Quitar uno que no existe no falla.',
  })
  @ApiNoContentResponse()
  async unblock(
    @CurrentActor() actor: ActorContext,
    @Param() params: ChatBlockRouteParamsDto,
  ): Promise<void> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    await this.unblockPerson.execute(actor, params.blockedMembershipId);
  }
}
