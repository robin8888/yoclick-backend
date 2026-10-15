import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
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
  ListContactsUseCase,
  ListConversationsUseCase,
  MarkConversationReadUseCase,
  OpenConversationUseCase,
} from '../application/chat.use-cases';
import {
  CenterRouteParamsDto,
  ContactListResponseDto,
  ConversationListResponseDto,
  ConversationRouteParamsDto,
  OpenConversationRequestDto,
  OpenConversationResponseDto,
} from './chat.dto';

@ApiTags('chat')
@ApiBearerAuth('bearer')
@ApiHeader({ name: 'X-Center-Id', required: true })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('centers/:centerId/conversations')
export class ConversationsController {
  constructor(
    private readonly listConversations: ListConversationsUseCase,
    private readonly listContacts: ListContactsUseCase,
    private readonly openConversation: OpenConversationUseCase,
    private readonly markRead: MarkConversationReadUseCase,
    private readonly presenter: ChatPresenter,
  ) {}

  @Get()
  @Roles('owner', 'admin', 'staff', 'client')
  @ApiOperation({
    operationId: 'chat_list_conversations',
    summary:
      'Las conversaciones de quien pregunta, de la más reciente a la más antigua, con los mensajes sin leer. La administración ve solo las dirigidas al centro.',
  })
  @ApiOkResponse({ type: ConversationListResponseDto })
  async list(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterRouteParamsDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const conversations = await this.listConversations.execute(actor);
    return {
      unreadTotal: conversations.reduce((total, { unreadCount }) => total + unreadCount, 0),
      conversations: conversations.map((conversation) =>
        this.presenter.conversation(conversation, actor.membershipId),
      ),
    };
  }

  @Get('contacts')
  @Roles('owner', 'admin', 'staff', 'client')
  @ApiOperation({
    operationId: 'chat_list_contacts',
    summary:
      'Con quién puede empezar una conversación quien pregunta: el alumno, con los profesores y con el centro; el profesor, con los alumnos y con el centro; la administración, con cualquiera. Los alumnos menores no aparecen.',
  })
  @ApiOkResponse({ type: ContactListResponseDto })
  async contacts(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterRouteParamsDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const result = await this.listContacts.execute(actor);
    return {
      canWriteToCenter: result.canWriteToCenter,
      people: result.people.map((person) => this.presenter.contact(person)),
    };
  }

  @Post()
  @Roles('owner', 'admin', 'staff', 'client')
  @ApiOperation({
    operationId: 'chat_open_conversation',
    summary:
      'Abre (o devuelve la que ya existe) la conversación con una persona, o con el centro si no se indica. 403 CHAT_NOT_ALLOWED o CHAT_MINOR_REQUIRES_GUARDIAN; 404 si la persona no existe.',
  })
  @ApiCreatedResponse({ type: OpenConversationResponseDto })
  async open(
    @CurrentActor() actor: ActorContext,
    @Param() params: CenterRouteParamsDto,
    @Body() body: OpenConversationRequestDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    return {
      ...(await this.openConversation.execute(actor, {
        withMembershipId: body.withMembershipId ?? null,
      })),
    };
  }

  @Post(':conversationId/read')
  @Roles('owner', 'admin', 'staff', 'client')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    operationId: 'chat_mark_read',
    summary: 'Marca la conversación como leída por quien pregunta.',
  })
  @ApiNoContentResponse()
  async read(
    @CurrentActor() actor: ActorContext,
    @Param() params: ConversationRouteParamsDto,
  ): Promise<void> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    await this.markRead.execute(actor, params.conversationId);
  }
}
