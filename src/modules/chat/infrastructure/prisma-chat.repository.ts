import { Injectable } from '@nestjs/common';
import { v7 as generateUuidV7 } from 'uuid';
import {
  type TenantTransactionClient,
  TenantPrismaService,
} from '../../../shared/database/tenant-prisma.service';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import {
  type ChatRepository,
  type ContactList,
  type ConversationAccess,
  type ConversationView,
  type MessageView,
  type NewMessage,
  type StartConversationContext,
} from '../application/ports/chat.repository';
import { isMinor, MAX_CONVERSATIONS } from '../domain/chat-rules';
import { listContactsInTransaction } from './chat-contacts';
import { buildPersonContext, toConversationView } from './chat-conversations';
import { markMessageNoticesRead, recordMessageNotices } from './chat-notices';
import { MESSAGE_INCLUDE, PERSON_SELECT, toMessageView } from './chat-views';

const CONVERSATION_INCLUDE = {
  member: { select: PERSON_SELECT },
  counterpart: { select: PERSON_SELECT },
  messages: { orderBy: { createdAt: 'desc' }, take: 1, include: MESSAGE_INCLUDE },
} as const;

function findAttachmentFields(message: NewMessage): Record<string, unknown> {
  if (message.attachment === null) return {};
  return {
    attachmentKey: message.attachment.key,
    attachmentKind: message.attachment.kind,
    attachmentName: message.attachment.name,
    attachmentSizeBytes: message.attachment.sizeBytes,
  };
}

/** Guarda el mensaje, adelanta la conversación y deja el aviso a la otra parte. */
async function appendMessageInTransaction(
  client: TenantTransactionClient,
  input: { actor: ActorContext; message: NewMessage },
): Promise<MessageView> {
  const { actor, message } = input;
  const stored = await client.message.create({
    data: {
      id: message.id,
      centerId: actor.centerId,
      conversationId: message.conversationId,
      senderMembershipId: actor.membershipId,
      body: message.body,
      createdAt: message.sentAt,
      ...findAttachmentFields(message),
    },
    include: MESSAGE_INCLUDE,
  });
  const conversation = await client.conversation.findUniqueOrThrow({
    where: { id: message.conversationId },
  });
  const isMember = conversation.memberMembershipId === actor.membershipId;
  await client.conversation.update({
    where: { id: conversation.id },
    data: {
      lastMessageAt: message.sentAt,
      ...(isMember ? { memberLastReadAt: message.sentAt } : { otherLastReadAt: message.sentAt }),
    },
  });
  await recordMessageNotices(client, {
    conversation,
    senderMembershipId: actor.membershipId,
    senderName: stored.sender.user.fullName,
  });
  return toMessageView(stored);
}

async function loadCenterContext(
  client: TenantTransactionClient,
  input: { actor: ActorContext; now: Date },
): Promise<StartConversationContext> {
  const { actor, now } = input;
  return {
    facts: {
      actorRole: actor.role,
      counterpart: { kind: 'center' },
      isActorMinor: await isActorMinor(client, { actor, now }),
      isCounterpartMinor: false,
    },
    memberMembershipId: actor.membershipId,
    counterpartMembershipId: null,
  };
}

async function isActorMinor(
  client: TenantTransactionClient,
  input: { actor: ActorContext; now: Date },
): Promise<boolean> {
  const member = await client.membership.findUniqueOrThrow({
    where: { id: input.actor.membershipId },
    select: { user: { select: { birthDate: true } } },
  });
  return isMinor(member.user.birthDate, input.now);
}

@Injectable()
export class PrismaChatRepository implements ChatRepository {
  constructor(private readonly tenantPrismaService: TenantPrismaService) {}

  async listConversations(actor: ActorContext): Promise<ConversationView[]> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const conversations = await client.conversation.findMany({
        include: CONVERSATION_INCLUDE,
        orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
        take: MAX_CONVERSATIONS,
      });
      return Promise.all(
        conversations.map((conversation) => toConversationView(client, { conversation, actor })),
      );
    });
  }

  async listContacts(actor: ActorContext): Promise<ContactList> {
    return this.tenantPrismaService.runInTenantContext(actor, (client) =>
      listContactsInTransaction(client, { actor, now: new Date() }),
    );
  }

  async loadStartContext(
    actor: ActorContext,
    request: { withMembershipId: string | null; now: Date },
  ): Promise<StartConversationContext | null> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const { withMembershipId, now } = request;
      if (withMembershipId === null) return loadCenterContext(client, { actor, now });
      const target = await client.membership.findFirst({
        where: { id: withMembershipId, status: 'active' },
        select: PERSON_SELECT,
      });
      if (!target || target.id === actor.membershipId) return null;
      const isMinorActor = await isActorMinor(client, { actor, now });
      return buildPersonContext({ actor, target, isActorMinor: isMinorActor, now });
    });
  }

  async findOrCreateConversation(
    actor: ActorContext,
    parties: { memberMembershipId: string; counterpartMembershipId: string | null },
  ): Promise<string> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const existing = await client.conversation.findFirst({
        where: parties,
        select: { id: true },
      });
      if (existing) return existing.id;
      const created = await client.conversation.create({
        data: { id: generateUuidV7(), centerId: actor.centerId, ...parties },
        select: { id: true },
      });
      return created.id;
    });
  }

  async loadAccess(
    actor: ActorContext,
    request: { conversationId: string; now: Date },
  ): Promise<ConversationAccess | null> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const conversation = await client.conversation.findUnique({
        where: { id: request.conversationId },
        select: { id: true, member: { select: PERSON_SELECT } },
      });
      if (!conversation) return null;
      const { member } = conversation;
      return {
        conversationId: conversation.id,
        isBlockedByMinor: member.role === 'client' && isMinor(member.user.birthDate, request.now),
      };
    });
  }

  async listMessages(
    actor: ActorContext,
    query: { conversationId: string; before: Date | null; limit: number },
  ): Promise<MessageView[]> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const messages = await client.message.findMany({
        where: {
          conversationId: query.conversationId,
          ...(query.before === null ? {} : { createdAt: { lt: query.before } }),
        },
        include: MESSAGE_INCLUDE,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit,
      });
      return messages.map(toMessageView);
    });
  }

  async appendMessage(actor: ActorContext, message: NewMessage): Promise<MessageView> {
    return this.tenantPrismaService.runInTenantContext(actor, (client) =>
      appendMessageInTransaction(client, { actor, message }),
    );
  }

  async markRead(
    actor: ActorContext,
    request: { conversationId: string; readAt: Date },
  ): Promise<void> {
    await this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const conversation = await client.conversation.findUniqueOrThrow({
        where: { id: request.conversationId },
        select: { memberMembershipId: true },
      });
      const isMember = conversation.memberMembershipId === actor.membershipId;
      await client.conversation.update({
        where: { id: request.conversationId },
        data: isMember ? { memberLastReadAt: request.readAt } : { otherLastReadAt: request.readAt },
      });
      await markMessageNoticesRead(client, {
        conversationId: request.conversationId,
        membershipId: actor.membershipId,
        readAt: request.readAt,
      });
    });
  }
}
