import { v7 as generateUuidV7 } from 'uuid';
import { type TenantTransactionClient } from '../../../shared/database/tenant-prisma.service';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import {
  type BroadcastTarget,
  type GroupBroadcastOutcome,
} from '../application/ports/chat.repository';
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

interface RecipientCandidate {
  readonly id: string;
  readonly user: { readonly birthDate: Date | null };
}

type Audience = { readonly candidates: RecipientCandidate[] } | null;

/** Las personas activas de un grupo de clientes (el de la ficha del alumno). */
async function findGroupAudience(
  client: TenantTransactionClient,
  groupId: string,
): Promise<Audience> {
  const group = await client.clientGroup.findFirst({
    where: { id: groupId, archivedAt: null },
    select: { id: true },
  });
  if (!group) return null;
  const candidates = await client.membership.findMany({
    where: { groupId, role: 'client', status: 'active' },
    select: { id: true, user: { select: { birthDate: true } } },
  });
  return { candidates };
}

/** Las personas apuntadas ahora a una clase fija de «Gestión» (su grupo fijo). */
async function findSeriesAudience(
  client: TenantTransactionClient,
  input: { seriesId: string; today: Date },
): Promise<Audience> {
  const series = await client.sessionSchedule.findFirst({
    where: { seriesId: input.seriesId },
    select: { id: true },
  });
  if (!series) return null;
  const enrollments = await client.scheduleEnrollment.findMany({
    where: {
      seriesId: input.seriesId,
      status: 'active',
      OR: [{ endsOn: null }, { endsOn: { gte: input.today } }],
      clientMembership: { status: 'active', role: 'client' },
    },
    select: { clientMembership: { select: { id: true, user: { select: { birthDate: true } } } } },
  });
  return { candidates: enrollments.map(({ clientMembership }) => clientMembership) };
}

function findAudience(
  client: TenantTransactionClient,
  input: { target: BroadcastTarget; today: Date },
): Promise<Audience> {
  const { target, today } = input;
  if (target.kind === 'group') return findGroupAudience(client, target.groupId);
  return findSeriesAudience(client, { seriesId: target.seriesId, today });
}

/**
 * Manda el mismo mensaje a cada persona de un grupo o de una clase fija, cada una en su
 * conversación con el centro: así las respuestas vuelven por separado y nadie ve quién más lo ha
 * recibido. Los menores no reciben (solo se les escribe a través de su tutor) y se cuentan aparte.
 */
export async function broadcastInTransaction(
  client: TenantTransactionClient,
  input: { actor: ActorContext; target: BroadcastTarget; body: string; sentAt: Date },
): Promise<GroupBroadcastOutcome> {
  const { actor, target, body, sentAt } = input;
  const audience = await findAudience(client, { target, today: sentAt });
  if (audience === null) return { kind: 'group_not_found' };
  const recipients = audience.candidates.filter(({ user }) => !isMinor(user.birthDate, sentAt));
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
    skippedMinorCount: audience.candidates.length - recipients.length,
  };
}
