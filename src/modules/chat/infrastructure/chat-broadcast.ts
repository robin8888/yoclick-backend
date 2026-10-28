import { v7 as generateUuidV7 } from 'uuid';
import { type TenantTransactionClient } from '../../../shared/database/tenant-prisma.service';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import {
  type BroadcastTarget,
  type GroupBroadcastOutcome,
} from '../application/ports/chat.repository';
import { isMinor } from '../domain/chat-rules';
import { findBlockPartnerIds } from './chat-blocks';
import { appendMessageInTransaction } from './chat-messages';

/**
 * La administración habla en nombre del centro (la bandeja del centro, que ve la administración);
 * un profesor habla en persona, en su propia conversación con cada alumno.
 */
async function findOrCreateConversation(
  client: TenantTransactionClient,
  input: { actor: ActorContext; clientMembershipId: string },
): Promise<string> {
  const parties = {
    memberMembershipId: input.clientMembershipId,
    counterpartMembershipId: input.actor.role === 'staff' ? input.actor.membershipId : null,
  };
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
  readonly user: { readonly birthDate: Date | null; readonly fullName: string };
}

type Audience = { readonly candidates: RecipientCandidate[] } | null;

/** Las personas activas de un grupo de clientes (el de la ficha del alumno). */
async function findGroupAudience(
  client: TenantTransactionClient,
  input: { groupId: string; actor: ActorContext },
): Promise<Audience> {
  const { groupId, actor } = input;
  // Un profesor solo escribe a los grupos que él da.
  const group = await client.clientGroup.findFirst({
    where: {
      id: groupId,
      archivedAt: null,
      ...(actor.role === 'staff' && { instructorMembershipId: actor.membershipId }),
    },
    select: { id: true },
  });
  if (!group) return null;
  const candidates = await client.membership.findMany({
    where: { groupId, role: 'client', status: 'active' },
    select: { id: true, user: { select: { birthDate: true, fullName: true } } },
  });
  return { candidates };
}

/** Las personas apuntadas ahora a una clase fija de «Gestión» (su grupo fijo). */
async function findSeriesAudience(
  client: TenantTransactionClient,
  input: { seriesId: string; today: Date; actor: ActorContext },
): Promise<Audience> {
  // Un profesor solo escribe a las clases que él da.
  const series = await client.sessionSchedule.findFirst({
    where: {
      seriesId: input.seriesId,
      ...(input.actor.role === 'staff' && { staffMembershipId: input.actor.membershipId }),
    },
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
    select: {
      clientMembership: {
        select: { id: true, user: { select: { birthDate: true, fullName: true } } },
      },
    },
  });
  return { candidates: enrollments.map(({ clientMembership }) => clientMembership) };
}

function findAudience(
  client: TenantTransactionClient,
  input: { target: BroadcastTarget; today: Date; actor: ActorContext },
): Promise<Audience> {
  const { target, today, actor } = input;
  if (target.kind === 'group') return findGroupAudience(client, { groupId: target.groupId, actor });
  return findSeriesAudience(client, { seriesId: target.seriesId, today, actor });
}

interface Delivery {
  recipientMembershipId: string;
  body: string;
}

/** Quien tiene tutores recibe por ellos: el mensaje de un menor va a su tutor, diciendo de quién es. */
async function planDeliveries(
  client: TenantTransactionClient,
  input: { candidates: readonly RecipientCandidate[]; body: string; now: Date },
): Promise<{ deliveries: Delivery[]; skippedMinorCount: number }> {
  const { candidates, body, now } = input;
  const adults = candidates.filter(({ user }) => !isMinor(user.birthDate, now));
  const minors = candidates.filter(({ user }) => isMinor(user.birthDate, now));
  const links = await client.guardianLink.findMany({
    where: { childMembershipId: { in: minors.map(({ id }) => id) } },
    select: { guardianMembershipId: true, childMembershipId: true },
  });
  const childNamesByGuardian = new Map<string, string[]>();
  for (const link of links) {
    const child = minors.find(({ id }) => id === link.childMembershipId);
    const names = childNamesByGuardian.get(link.guardianMembershipId) ?? [];
    childNamesByGuardian.set(link.guardianMembershipId, [...names, child?.user.fullName ?? '']);
  }
  const linkedChildIds = new Set(links.map(({ childMembershipId }) => childMembershipId));
  const guardianDeliveries = [...childNamesByGuardian].map(([recipientMembershipId, names]) => ({
    recipientMembershipId,
    body: `Para ${names.join(', ')}: ${body}`,
  }));
  return {
    deliveries: [
      ...adults.map(({ id }) => ({ recipientMembershipId: id, body })),
      ...guardianDeliveries,
    ],
    skippedMinorCount: minors.filter(({ id }) => !linkedChildIds.has(id)).length,
  };
}

/**
 * Un profesor habla en persona, así que respeta los bloqueos: no escribe a quien le ha bloqueado ni a quien
 * él ha bloqueado. La administración habla en nombre del centro y no tiene bloqueos.
 */
async function withoutBlockedRecipients(
  client: TenantTransactionClient,
  input: { actor: ActorContext; deliveries: readonly Delivery[] },
): Promise<Delivery[]> {
  if (input.actor.role !== 'staff') return [...input.deliveries];
  const partnerIds = await findBlockPartnerIds(client, input.actor);
  return input.deliveries.filter(
    ({ recipientMembershipId }) => !partnerIds.has(recipientMembershipId),
  );
}

/**
 * Manda el mismo mensaje a cada persona de un grupo o de una clase fija, cada una en su
 * conversación: así las respuestas vuelven por separado y nadie ve quién más lo ha recibido. Los
 * menores no tienen cuenta con la que hablar: el mensaje llega a su tutor y, si no tienen, se cuenta
 * aparte.
 */
export async function broadcastInTransaction(
  client: TenantTransactionClient,
  input: { actor: ActorContext; target: BroadcastTarget; body: string; sentAt: Date },
): Promise<GroupBroadcastOutcome> {
  const { actor, target, body, sentAt } = input;
  const audience = await findAudience(client, { target, today: sentAt, actor });
  if (audience === null) return { kind: 'group_not_found' };
  const plan = await planDeliveries(client, { candidates: audience.candidates, body, now: sentAt });
  const deliveries = await withoutBlockedRecipients(client, { actor, deliveries: plan.deliveries });
  for (const delivery of deliveries) {
    const conversationId = await findOrCreateConversation(client, {
      actor,
      clientMembershipId: delivery.recipientMembershipId,
    });
    await appendMessageInTransaction(client, {
      actor,
      message: {
        id: generateUuidV7(),
        conversationId,
        body: delivery.body,
        attachment: null,
        sentAt,
      },
    });
  }
  return {
    kind: 'sent',
    sentCount: deliveries.length,
    skippedMinorCount: plan.skippedMinorCount,
    recipientMembershipIds: deliveries.map(({ recipientMembershipId }) => recipientMembershipId),
  };
}
