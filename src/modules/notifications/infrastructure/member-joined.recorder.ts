import { v7 as generateUuidV7 } from 'uuid';
import { type TenantTransactionClient } from '../../../shared/database/tenant-prisma.service';
import { type MemberJoinedNotificationData } from '../domain/notification-rules';

export interface MemberJoinedInput {
  readonly centerId: string;
  /** La persona que acaba de quedar dada de alta. */
  readonly membershipId: string;
  readonly role: 'client' | 'staff' | 'admin' | 'owner';
}

/** Un propietario que entra no avisa a nadie: los roles que se avisan son los que se invitan. */
function toJoinedRole(
  role: MemberJoinedInput['role'],
): MemberJoinedNotificationData['role'] | null {
  return role === 'owner' ? null : role;
}

/**
 * Deja el aviso «se ha unido alguien» a la propiedad y la administración del centro, en la misma
 * transacción que el alta: o ocurren las dos cosas o ninguna. El envío al móvil ocurre después.
 */
export async function recordMemberJoinedNotice(
  client: TenantTransactionClient,
  input: MemberJoinedInput,
): Promise<void> {
  const role = toJoinedRole(input.role);
  if (role === null) return;
  const recipients = await client.membership.findMany({
    where: { role: { in: ['owner', 'admin'] }, status: 'active', id: { not: input.membershipId } },
    select: { id: true },
  });
  if (recipients.length === 0) return;
  const person = await client.membership.findUnique({
    where: { id: input.membershipId },
    select: { user: { select: { fullName: true } } },
  });
  const noticeData: MemberJoinedNotificationData = {
    personName: person?.user.fullName ?? '',
    role,
  };
  await client.notification.createMany({
    data: recipients.map(({ id }) => ({
      id: generateUuidV7(),
      centerId: input.centerId,
      recipientMembershipId: id,
      kind: 'member_joined' as const,
      data: noticeData,
    })),
  });
}
