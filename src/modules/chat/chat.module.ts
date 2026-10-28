import { Module } from '@nestjs/common';
import {
  BlockPersonUseCase,
  ListBlockedPeopleUseCase,
  ListMessageReportsUseCase,
  ReportMessageUseCase,
  ReviewMessageReportUseCase,
  UnblockPersonUseCase,
} from './application/chat-moderation.use-cases';
import { ChatPresenter } from './application/chat-presenter';
import {
  BroadcastToGroupUseCase,
  ListBroadcastTargetsUseCase,
  ListContactsUseCase,
  ListConversationsUseCase,
  ListMessagesUseCase,
  MarkConversationReadUseCase,
  OpenConversationUseCase,
  SendAttachmentUseCase,
  SendTextMessageUseCase,
} from './application/chat.use-cases';
import { CHAT_MODERATION_REPOSITORY } from './application/ports/chat-moderation.repository';
import { CHAT_REPOSITORY } from './application/ports/chat.repository';
import { ChatBlocksController } from './http/chat-blocks.controller';
import { ConversationsController } from './http/conversations.controller';
import { GroupBroadcastController } from './http/group-broadcast.controller';
import { MessageReportsController } from './http/message-reports.controller';
import { MessagesController } from './http/messages.controller';
import { PrismaChatModerationRepository } from './infrastructure/prisma-chat-moderation.repository';
import { PrismaChatRepository } from './infrastructure/prisma-chat.repository';

/**
 * Mensajes internos entre alumnos, profesores y el centro (PhotosModule, global, da archivos y enlaces), con
 * denuncia de mensajes y bloqueo de personas (Apple 1.2).
 */
@Module({
  controllers: [
    ChatBlocksController,
    ConversationsController,
    GroupBroadcastController,
    MessageReportsController,
    MessagesController,
  ],
  providers: [
    BlockPersonUseCase,
    BroadcastToGroupUseCase,
    ChatPresenter,
    ListBroadcastTargetsUseCase,
    ListBlockedPeopleUseCase,
    ListContactsUseCase,
    ListConversationsUseCase,
    ListMessageReportsUseCase,
    ListMessagesUseCase,
    MarkConversationReadUseCase,
    OpenConversationUseCase,
    ReportMessageUseCase,
    ReviewMessageReportUseCase,
    SendAttachmentUseCase,
    SendTextMessageUseCase,
    UnblockPersonUseCase,
    { provide: CHAT_REPOSITORY, useClass: PrismaChatRepository },
    { provide: CHAT_MODERATION_REPOSITORY, useClass: PrismaChatModerationRepository },
  ],
})
export class ChatModule {}
