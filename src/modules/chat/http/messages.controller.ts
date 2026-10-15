import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiDefaultResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { type FastifyRequest } from 'fastify';
import { CurrentActor } from '../../../shared/auth/decorators/current-actor.decorator';
import { Roles } from '../../../shared/auth/decorators/roles.decorator';
import { DomainError } from '../../../shared/errors/domain-error';
import { HTTP_STATUS } from '../../../shared/errors/http-status';
import { ProblemDetailsDto } from '../../../shared/errors/problem-details.dto';
import { RATE_LIMITS } from '../../../shared/rate-limit/rate-limit-policies';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { assertRouteTargetsActorCenter } from '../../../shared/tenancy/assert-route-targets-actor-center';
import { PHOTO_CONTENT_TYPES } from '../../photos/domain/photo-rules';
import { ChatPresenter } from '../application/chat-presenter';
import {
  ListMessagesUseCase,
  SendAttachmentUseCase,
  SendTextMessageUseCase,
} from '../application/chat.use-cases';
import {
  ConversationRouteParamsDto,
  MessageListQueryDto,
  MessageListResponseDto,
  MessageResponseDto,
  SendAttachmentQueryDto,
  SendMessageRequestDto,
} from './chat.dto';

@ApiTags('chat')
@ApiBearerAuth('bearer')
@ApiHeader({ name: 'X-Center-Id', required: true })
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('centers/:centerId/conversations/:conversationId')
export class MessagesController {
  constructor(
    private readonly listMessages: ListMessagesUseCase,
    private readonly sendText: SendTextMessageUseCase,
    private readonly sendAttachment: SendAttachmentUseCase,
    private readonly presenter: ChatPresenter,
  ) {}

  @Get('messages')
  @Roles('owner', 'admin', 'staff', 'client')
  @ApiOperation({
    operationId: 'chat_list_messages',
    summary:
      'Los mensajes de una conversación, del más reciente al más antiguo (`before` pagina hacia atrás). 404 si no existe o no es tuya.',
  })
  @ApiOkResponse({ type: MessageListResponseDto })
  async list(
    @CurrentActor() actor: ActorContext,
    @Param() params: ConversationRouteParamsDto,
    @Query() query: MessageListQueryDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const messages = await this.listMessages.execute(actor, {
      conversationId: params.conversationId,
      before: query.before === undefined ? null : new Date(query.before),
      limit: query.limit,
    });
    return { messages: messages.map((message) => this.presenter.message(message)) };
  }

  @Post('messages')
  @Roles('owner', 'admin', 'staff', 'client')
  @ApiOperation({
    operationId: 'chat_send_message',
    summary:
      'Envía un mensaje de texto (hasta 2000 caracteres). 404 si la conversación no existe o no es tuya; 403 CHAT_MINOR_REQUIRES_GUARDIAN.',
  })
  @ApiCreatedResponse({ type: MessageResponseDto })
  async send(
    @CurrentActor() actor: ActorContext,
    @Param() params: ConversationRouteParamsDto,
    @Body() body: SendMessageRequestDto,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    const message = await this.sendText.execute(actor, {
      conversationId: params.conversationId,
      body: body.body,
    });
    return this.presenter.message(message);
  }

  @Post('attachments')
  @Throttle({ default: RATE_LIMITS.uploadDocument })
  @Roles('owner', 'admin', 'staff', 'client')
  @ApiOperation({
    operationId: 'chat_send_attachment',
    summary:
      'Envía una imagen (JPEG, PNG o WebP, hasta 5 MB) o un PDF (hasta 10 MB) como mensaje; el cuerpo es el fichero y `fileName` su nombre. 400 CHAT_ATTACHMENT_UNSUPPORTED, 413 CHAT_ATTACHMENT_TOO_LARGE, 429 RATE_LIMITED.',
  })
  @ApiConsumes(...PHOTO_CONTENT_TYPES, 'application/pdf')
  @ApiBody({ schema: { type: 'string', format: 'binary' } })
  @ApiCreatedResponse({ type: MessageResponseDto })
  async attach(
    @CurrentActor() actor: ActorContext,
    @Param() params: ConversationRouteParamsDto,
    @Query() query: SendAttachmentQueryDto,
    @Req() request: FastifyRequest,
  ): Promise<Record<string, unknown>> {
    assertRouteTargetsActorCenter(actor, params.centerId);
    if (!Buffer.isBuffer(request.body)) {
      throw new DomainError('CHAT_ATTACHMENT_UNSUPPORTED', HTTP_STATUS.badRequest);
    }
    const message = await this.sendAttachment.execute(actor, {
      conversationId: params.conversationId,
      bytes: request.body,
      fileName: query.fileName,
    });
    return this.presenter.message(message);
  }
}
