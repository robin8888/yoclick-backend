import { Inject, Injectable } from '@nestjs/common';
import { v7 as generateUuidV7 } from 'uuid';
import { RealtimePublisher } from '../../realtime/application/realtime.publisher';
import { DomainError } from '../../../shared/errors/domain-error';
import { HTTP_STATUS } from '../../../shared/errors/http-status';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { PhotoFileKeeper } from '../../photos/application/photo-file-keeper';
import { findOtherPerson } from '../domain/chat-moderation-rules';
import {
  buildChatAttachmentKey,
  decideAttachment,
  decideStartConversation,
  sanitizeAttachmentName,
} from '../domain/chat-rules';
import {
  CHAT_REPOSITORY,
  type BroadcastTarget,
  type BroadcastTargetsView,
  type ChatRepository,
  type ContactList,
  type GroupBroadcastOutcome,
  type ConversationAccess,
  type ConversationView,
  type MessageView,
} from './ports/chat.repository';

@Injectable()
export class ListConversationsUseCase {
  constructor(@Inject(CHAT_REPOSITORY) private readonly chat: ChatRepository) {}

  execute(actor: ActorContext): Promise<ConversationView[]> {
    return this.chat.listConversations(actor);
  }
}

@Injectable()
export class ListContactsUseCase {
  constructor(@Inject(CHAT_REPOSITORY) private readonly chat: ChatRepository) {}

  execute(actor: ActorContext): Promise<ContactList> {
    return this.chat.listContacts(actor);
  }
}

@Injectable()
export class OpenConversationUseCase {
  constructor(@Inject(CHAT_REPOSITORY) private readonly chat: ChatRepository) {}

  /** `withMembershipId` nulo es escribir «al centro»; devuelve la conversación ya existente si la hay. */
  async execute(
    actor: ActorContext,
    request: { withMembershipId: string | null },
  ): Promise<{ conversationId: string }> {
    const context = await this.chat.loadStartContext(actor, {
      withMembershipId: request.withMembershipId,
      now: new Date(),
    });
    if (context === null) throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
    const decision = decideStartConversation(context.facts);
    if (decision.kind === 'denied') throw new DomainError(decision.code, HTTP_STATUS.forbidden);
    await assertNoBlockWithOtherPerson(this.chat, actor, {
      otherMembershipId: findOtherPerson({
        viewerMembershipId: actor.membershipId,
        memberMembershipId: context.memberMembershipId,
        counterpartMembershipId: context.counterpartMembershipId,
      }),
    });
    const conversationId = await this.chat.findOrCreateConversation(actor, {
      memberMembershipId: context.memberMembershipId,
      counterpartMembershipId: context.counterpartMembershipId,
    });
    return { conversationId };
  }
}

/**
 * Si alguna de las dos personas ha bloqueado a la otra no se puede hablar. El error es el mismo de siempre
 * cuando una conversación no está permitida: no dice quién bloqueó a quién ni que haya un bloqueo.
 */
async function assertNoBlockWithOtherPerson(
  chat: ChatRepository,
  actor: ActorContext,
  input: { otherMembershipId: string | null },
): Promise<void> {
  if (input.otherMembershipId === null) return;
  if (await chat.hasChatBlockBetween(actor, input.otherMembershipId)) {
    throw new DomainError('CHAT_NOT_ALLOWED', HTTP_STATUS.forbidden);
  }
}

async function loadWritableConversation(
  chat: ChatRepository,
  actor: ActorContext,
  conversationId: string,
): Promise<ConversationAccess> {
  const access = await chat.loadAccess(actor, { conversationId, now: new Date() });
  if (access === null) throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
  if (access.isBlockedByMinor) {
    throw new DomainError('CHAT_MINOR_REQUIRES_GUARDIAN', HTTP_STATUS.forbidden);
  }
  await assertNoBlockWithOtherPerson(chat, actor, {
    otherMembershipId: access.otherPersonMembershipId,
  });
  return access;
}

/** Avisa en directo a quienes ven la conversación; va DESPUÉS de guardar el mensaje. */
function announceNewMessage(
  realtime: RealtimePublisher,
  input: { actor: ActorContext; access: ConversationAccess },
): void {
  realtime.publishChatUpdated({
    centerId: input.actor.centerId,
    membershipIds: input.access.audienceMembershipIds,
    conversationId: input.access.conversationId,
  });
}

@Injectable()
export class ListMessagesUseCase {
  constructor(@Inject(CHAT_REPOSITORY) private readonly chat: ChatRepository) {}

  async execute(
    actor: ActorContext,
    query: { conversationId: string; before: Date | null; limit: number },
  ): Promise<MessageView[]> {
    const access = await this.chat.loadAccess(actor, {
      conversationId: query.conversationId,
      now: new Date(),
    });
    if (access === null) throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
    return this.chat.listMessages(actor, query);
  }
}

@Injectable()
export class SendTextMessageUseCase {
  constructor(
    @Inject(CHAT_REPOSITORY) private readonly chat: ChatRepository,
    private readonly realtime: RealtimePublisher,
  ) {}

  async execute(
    actor: ActorContext,
    request: { conversationId: string; body: string },
  ): Promise<MessageView> {
    const access = await loadWritableConversation(this.chat, actor, request.conversationId);
    const message = await this.chat.appendMessage(actor, {
      id: generateUuidV7(),
      conversationId: request.conversationId,
      body: request.body,
      attachment: null,
      sentAt: new Date(),
    });
    announceNewMessage(this.realtime, { actor, access });
    return message;
  }
}

@Injectable()
export class SendAttachmentUseCase {
  constructor(
    @Inject(CHAT_REPOSITORY) private readonly chat: ChatRepository,
    private readonly files: PhotoFileKeeper,
    private readonly realtime: RealtimePublisher,
  ) {}

  async execute(
    actor: ActorContext,
    request: { conversationId: string; bytes: Buffer; fileName: string | undefined },
  ): Promise<MessageView> {
    const access = await loadWritableConversation(this.chat, actor, request.conversationId);
    const decision = decideAttachment(request.bytes);
    if (decision.kind === 'unsupported') {
      throw new DomainError('CHAT_ATTACHMENT_UNSUPPORTED', HTTP_STATUS.badRequest);
    }
    if (decision.kind === 'too_large') {
      throw new DomainError('CHAT_ATTACHMENT_TOO_LARGE', HTTP_STATUS.payloadTooLarge);
    }
    const messageId = generateUuidV7();
    const key = buildChatAttachmentKey({
      centerId: actor.centerId,
      conversationId: request.conversationId,
      messageId,
      extension: decision.extension,
    });
    await this.files.save({ key, bytes: request.bytes });
    try {
      const message = await this.chat.appendMessage(actor, {
        id: messageId,
        conversationId: request.conversationId,
        body: null,
        attachment: {
          kind: decision.kind,
          key,
          sizeBytes: request.bytes.length,
          name: sanitizeAttachmentName(request.fileName, `adjunto.${decision.extension}`),
        },
        sentAt: new Date(),
      });
      announceNewMessage(this.realtime, { actor, access });
      return message;
    } catch (error) {
      await this.files.discard(key);
      throw error;
    }
  }
}

@Injectable()
export class MarkConversationReadUseCase {
  constructor(@Inject(CHAT_REPOSITORY) private readonly chat: ChatRepository) {}

  async execute(actor: ActorContext, conversationId: string): Promise<void> {
    const access = await this.chat.loadAccess(actor, { conversationId, now: new Date() });
    if (access === null) throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
    await this.chat.markRead(actor, { conversationId, readAt: new Date() });
  }
}

@Injectable()
export class BroadcastToGroupUseCase {
  constructor(
    @Inject(CHAT_REPOSITORY) private readonly chat: ChatRepository,
    private readonly realtime: RealtimePublisher,
  ) {}

  /** La administración escribe a todas las personas de un grupo, cada una en su conversación con el centro. */
  async execute(
    actor: ActorContext,
    request: { target: BroadcastTarget; body: string },
  ): Promise<Extract<GroupBroadcastOutcome, { kind: 'sent' }>> {
    const outcome = await this.chat.broadcastToGroup(actor, { ...request, sentAt: new Date() });
    if (outcome.kind === 'group_not_found')
      throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
    this.realtime.publishChatUpdated({
      centerId: actor.centerId,
      membershipIds: outcome.recipientMembershipIds,
      conversationId: null,
    });
    return outcome;
  }
}

@Injectable()
export class ListBroadcastTargetsUseCase {
  constructor(@Inject(CHAT_REPOSITORY) private readonly chat: ChatRepository) {}

  execute(actor: ActorContext): Promise<BroadcastTargetsView> {
    return this.chat.listBroadcastTargets(actor);
  }
}
