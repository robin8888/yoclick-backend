import { type TenantTransactionClient } from '../../../shared/database/tenant-prisma.service';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import {
  type ConversationView,
  type CounterpartView,
  type StartConversationContext,
} from '../application/ports/chat.repository';
import { isMinor } from '../domain/chat-rules';
import {
  toMessageView,
  toPersonCounterpart,
  type StoredMessage,
  type StoredPerson,
} from './chat-views';

export interface StoredConversation {
  readonly id: string;
  readonly memberMembershipId: string;
  readonly lastMessageAt: Date;
  readonly memberLastReadAt: Date | null;
  readonly otherLastReadAt: Date | null;
  readonly member: StoredPerson;
  readonly counterpart: StoredPerson | null;
  readonly messages: readonly StoredMessage[];
}

/** Con quién habla quien mira: la persona de enfrente, o el centro si la conversación es suya. */
function resolveCounterpart(conversation: StoredConversation, isMember: boolean): CounterpartView {
  if (!isMember) return toPersonCounterpart(conversation.member);
  if (conversation.counterpart === null) return { kind: 'center' };
  return toPersonCounterpart(conversation.counterpart);
}

/** Mensajes de la otra parte posteriores a la última vez que quien mira abrió la conversación. */
async function countUnreadMessages(
  client: TenantTransactionClient,
  input: { conversation: StoredConversation; isMember: boolean },
): Promise<number> {
  const { conversation, isMember } = input;
  const lastReadAt = isMember ? conversation.memberLastReadAt : conversation.otherLastReadAt;
  return client.message.count({
    where: {
      conversationId: conversation.id,
      ...(lastReadAt === null ? {} : { createdAt: { gt: lastReadAt } }),
      senderMembershipId: isMember
        ? { not: conversation.memberMembershipId }
        : conversation.memberMembershipId,
    },
  });
}

export async function toConversationView(
  client: TenantTransactionClient,
  input: { conversation: StoredConversation; actor: ActorContext },
): Promise<ConversationView> {
  const { conversation, actor } = input;
  const isMember = conversation.memberMembershipId === actor.membershipId;
  const [lastMessage] = conversation.messages;
  return {
    id: conversation.id,
    counterpart: resolveCounterpart(conversation, isMember),
    lastMessage: lastMessage ? toMessageView(lastMessage) : null,
    lastMessageAt: conversation.lastMessageAt,
    unreadCount: await countUnreadMessages(client, { conversation, isMember }),
  };
}

async function haveSharedClass(
  client: TenantTransactionClient,
  input: { actorRole: ActorContext['role']; actorId: string; target: StoredPerson },
): Promise<boolean> {
  const { actorRole, actorId, target } = input;
  const isClientWithStaff =
    (actorRole === 'client' && target.role === 'staff') ||
    (actorRole === 'staff' && target.role === 'client');
  if (!isClientWithStaff) return false;
  const clientId = actorRole === 'client' ? actorId : target.id;
  const staffId = actorRole === 'client' ? target.id : actorId;
  const shared = await client.booking.count({
    where: { clientMembershipId: clientId, classSession: { staffMembershipId: staffId } },
  });
  return shared > 0;
}

/** Quién es la persona de la conversación y quién la otra parte (nula: el centro). */
function assignParties(
  actor: ActorContext,
  target: StoredPerson,
): { memberMembershipId: string; counterpartMembershipId: string | null } {
  if (actor.role === 'owner' || actor.role === 'admin') {
    return { memberMembershipId: target.id, counterpartMembershipId: null };
  }
  if (actor.role === 'staff' && target.role === 'client') {
    return { memberMembershipId: target.id, counterpartMembershipId: actor.membershipId };
  }
  return { memberMembershipId: actor.membershipId, counterpartMembershipId: target.id };
}

export async function buildPersonContext(
  client: TenantTransactionClient,
  input: { actor: ActorContext; target: StoredPerson; isActorMinor: boolean; now: Date },
): Promise<StartConversationContext> {
  const { actor, target, isActorMinor, now } = input;
  return {
    facts: {
      actorRole: actor.role,
      counterpart: { kind: 'person', role: target.role },
      isActorMinor,
      isCounterpartMinor: isMinor(target.user.birthDate, now),
      haveSharedClass: await haveSharedClass(client, {
        actorRole: actor.role,
        actorId: actor.membershipId,
        target,
      }),
    },
    ...assignParties(actor, target),
  };
}
