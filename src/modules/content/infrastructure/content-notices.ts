import { v7 as generateUuidV7 } from 'uuid';
import { type TenantTransactionClient } from '../../../shared/database/tenant-prisma.service';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { type ContentNotificationData } from '../../notifications/domain/notification-rules';
import { type ContentTarget } from '../domain/content-rules';

/** Quién se entera de un contenido asignado: los clientes activos de ese nivel o grupo, la persona o todos. */
async function findRecipientsOfTarget(
  client: TenantTransactionClient,
  target: ContentTarget,
): Promise<string[]> {
  const members = await client.membership.findMany({
    where: {
      role: 'client',
      status: 'active',
      ...(target.kind === 'level' && { level: target.level }),
      ...(target.kind === 'group' && { groupId: target.groupId }),
      ...(target.kind === 'client' && { id: target.membershipId }),
    },
    select: { id: true },
  });
  return members.map(({ id }) => id);
}

/** Cada persona una sola vez, aunque el contenido le llegue por su nivel y por su grupo; menos quien lo asigna. */
async function findDistinctRecipients(
  client: TenantTransactionClient,
  request: { targets: readonly ContentTarget[]; actorMembershipId: string },
): Promise<string[]> {
  const recipients = new Set<string>();
  for (const target of request.targets) {
    for (const id of await findRecipientsOfTarget(client, target)) recipients.add(id);
  }
  recipients.delete(request.actorMembershipId);
  return [...recipients];
}

/** Deja el aviso de contenido nuevo; se escribe con el cambio y el envío al móvil ocurre después. */
export async function recordContentNotices(
  client: TenantTransactionClient,
  actor: ActorContext,
  request: { contentTitle: string; targets: readonly ContentTarget[] },
): Promise<void> {
  const recipients = await findDistinctRecipients(client, {
    targets: request.targets,
    actorMembershipId: actor.membershipId,
  });
  if (recipients.length === 0) return;
  const actorMember = await client.membership.findUnique({
    where: { id: actor.membershipId },
    select: { user: { select: { fullName: true } } },
  });
  const noticeData: ContentNotificationData = {
    contentTitle: request.contentTitle,
    actorName: actorMember?.user.fullName ?? '',
  };
  await client.notification.createMany({
    data: recipients.map((recipientMembershipId) => ({
      id: generateUuidV7(),
      centerId: actor.centerId,
      recipientMembershipId,
      kind: 'content_assigned',
      data: noticeData,
    })),
  });
}
