import { v7 as generateUuidV7 } from 'uuid';
import { type TenantTransactionClient } from '../../../shared/database/tenant-prisma.service';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { type GroupBroadcastOutcome } from '../application/ports/chat.repository';
import { isMinor } from '../domain/chat-rules';
import { appendMessageInTransaction } from './chat-messages';

async function findOrCreateCenterConversation(
  client: TenantTransactionClient,
  input: { actor: ActorContext; clientMembershipId: string },
): Promise<string> {
  const parties = { memberMembershipId: input.clientMembershipId, counterpartMembershipId: null };
  const existing = await client.conversation.findFirst({ where: parties, select: { id: true } });
  if (existing) return existing.id;
  const created = await client.conversation.create({
    data: { id: generateUuidV7(), centerId: input.actor.centerId, ...parties },
    select: { id: true },
  });
  return created.id;
}

/**
 * Manda el mismo mensaje a cada persona de un grupo, cada una en su conversación con el centro: así
 * las respuestas vuelven por separado y nadie ve quién más lo ha recibido. Los menores no reciben
 * (solo se les escribe a través de su tutor) y se cuentan aparte.
 */
export async function broadcastToGroupInTransaction(
  client: TenantTransactionClient,
  input: { actor: ActorContext; groupId: string; body: string; sentAt: Date },
): Promise<GroupBroadcastOutcome> {
  const { actor, groupId, body, sentAt } = input;
  const group = await client.clientGroup.findFirst({
    where: { id: groupId, archivedAt: null },
    select: { id: true },
  });
  if (!group) return { kind: 'group_not_found' };
  const members = await client.membership.findMany({
    where: { groupId, role: 'client', status: 'active' },
    select: { id: true, user: { select: { birthDate: true } } },
  });
  const recipients = members.filter(({ user }) => !isMinor(user.birthDate, sentAt));
  for (const recipient of recipients) {
    const conversationId = await findOrCreateCenterConversation(client, {
      actor,
      clientMembershipId: recipient.id,
    });
    await appendMessageInTransaction(client, {
      actor,
      message: { id: generateUuidV7(), conversationId, body, attachment: null, sentAt },
    });
  }
  return {
    kind: 'sent',
    sentCount: recipients.length,
    skippedMinorCount: members.length - recipients.length,
  };
}
