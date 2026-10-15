import { v7 as generateUuidV7 } from 'uuid';
import { type TenantTransactionClient } from '../../../shared/database/tenant-prisma.service';

interface ConversationParties {
  readonly id: string;
  readonly centerId: string;
  readonly memberMembershipId: string;
  readonly counterpartMembershipId: string | null;
}

/** Quién debe enterarse de un mensaje: la otra parte, o la administración si va al centro. */
async function findRecipients(
  client: TenantTransactionClient,
  input: { conversation: ConversationParties; senderMembershipId: string },
): Promise<string[]> {
  const { conversation, senderMembershipId } = input;
  const isFromMember = senderMembershipId === conversation.memberMembershipId;
  if (!isFromMember) return [conversation.memberMembershipId];
  if (conversation.counterpartMembershipId !== null) {
    return [conversation.counterpartMembershipId];
  }
  const administrators = await client.membership.findMany({
    where: { role: { in: ['owner', 'admin'] }, status: 'active' },
    select: { id: true },
  });
  return administrators.map(({ id }) => id);
}

/**
 * Un aviso por conversación mientras quien lo recibe no lo lea: diez mensajes seguidos no deben
 * llenar su bandeja de diez avisos.
 */
export async function recordMessageNotices(
  client: TenantTransactionClient,
  input: { conversation: ConversationParties; senderMembershipId: string; senderName: string },
): Promise<void> {
  const { conversation, senderMembershipId, senderName } = input;
  const recipients = (await findRecipients(client, { conversation, senderMembershipId })).filter(
    (recipientId) => recipientId !== senderMembershipId,
  );
  if (recipients.length === 0) return;
  const alreadyNotified = await client.notification.findMany({
    where: {
      recipientMembershipId: { in: recipients },
      kind: 'message_received',
      readAt: null,
      deletedAt: null,
      data: { path: ['conversationId'], equals: conversation.id },
    },
    select: { recipientMembershipId: true },
  });
  const notifiedIds = new Set(
    alreadyNotified.map(({ recipientMembershipId }) => recipientMembershipId),
  );
  const pending = recipients.filter((recipientId) => !notifiedIds.has(recipientId));
  await client.notification.createMany({
    data: pending.map((recipientId) => ({
      id: generateUuidV7(),
      centerId: conversation.centerId,
      recipientMembershipId: recipientId,
      kind: 'message_received' as const,
      data: { conversationId: conversation.id, senderName },
    })),
  });
}

/** Al abrir la conversación se dan por leídos sus avisos. */
export async function markMessageNoticesRead(
  client: TenantTransactionClient,
  input: { conversationId: string; membershipId: string; readAt: Date },
): Promise<void> {
  await client.notification.updateMany({
    where: {
      recipientMembershipId: input.membershipId,
      kind: 'message_received',
      readAt: null,
      data: { path: ['conversationId'], equals: input.conversationId },
    },
    data: { readAt: input.readAt },
  });
}
