import { type TenantTransactionClient } from '../../../shared/database/tenant-prisma.service';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { type MessageView, type NewMessage } from '../application/ports/chat.repository';
import { recordMessageNotices } from './chat-notices';
import { MESSAGE_INCLUDE, toMessageView } from './chat-views';

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
export async function appendMessageInTransaction(
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
