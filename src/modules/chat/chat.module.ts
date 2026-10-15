import { Module } from '@nestjs/common';
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
import { CHAT_REPOSITORY } from './application/ports/chat.repository';
import { ConversationsController } from './http/conversations.controller';
import { GroupBroadcastController } from './http/group-broadcast.controller';
import { MessagesController } from './http/messages.controller';
import { PrismaChatRepository } from './infrastructure/prisma-chat.repository';

/** Mensajes internos entre alumnos, profesores y el centro (PhotosModule, global, da archivos y enlaces). */
@Module({
  controllers: [ConversationsController, GroupBroadcastController, MessagesController],
  providers: [
    BroadcastToGroupUseCase,
    ChatPresenter,
    ListBroadcastTargetsUseCase,
    ListContactsUseCase,
    ListConversationsUseCase,
    ListMessagesUseCase,
    MarkConversationReadUseCase,
    OpenConversationUseCase,
    SendAttachmentUseCase,
    SendTextMessageUseCase,
    { provide: CHAT_REPOSITORY, useClass: PrismaChatRepository },
  ],
})
export class ChatModule {}
