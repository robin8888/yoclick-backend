import { type TenantTransactionClient } from '../../../shared/database/tenant-prisma.service';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { type StoredContent } from '../application/ports/content.repository';

export const CONTENT_SELECT = {
  id: true,
  kind: true,
  title: true,
  need: true,
  level: true,
  sizeBytes: true,
  pageCount: true,
  createdAt: true,
  documentKey: true,
  video: { select: { providerVideoId: true, status: true, durationSeconds: true } },
  assignments: {
    orderBy: { assignedAt: 'asc' },
    select: {
      id: true,
      level: true,
      groupId: true,
      clientMembershipId: true,
      group: { select: { name: true } },
      client: { select: { user: { select: { fullName: true } } } },
    },
  },
} as const;

interface ContentRow {
  readonly id: string;
  readonly kind: StoredContent['kind'];
  readonly title: string;
  readonly need: string | null;
  readonly level: StoredContent['level'];
  readonly sizeBytes: bigint;
  readonly pageCount: number | null;
  readonly createdAt: Date;
  readonly documentKey: string | null;
  readonly video: StoredContent['video'];
  readonly assignments: readonly {
    id: string;
    level: StoredContent['level'];
    groupId: string | null;
    clientMembershipId: string | null;
    group: { name: string } | null;
    client: { user: { fullName: string } } | null;
  }[];
}

export function toStoredContent(row: ContentRow): StoredContent {
  return {
    ...row,
    assignments: row.assignments.map((assignment) => ({
      id: assignment.id,
      level: assignment.level,
      groupId: assignment.groupId,
      clientMembershipId: assignment.clientMembershipId,
      label: assignment.group?.name ?? assignment.client?.user.fullName ?? null,
    })),
  };
}

/**
 * Lo que ve un cliente: lo asignado a su nivel, a su grupo o a él, y los vídeos ya procesados.
 * Quien no tiene nivel o grupo solo recibe lo que se le asigne a él.
 */
export async function buildVisibleToClientFilter(
  client: TenantTransactionClient,
  actor: ActorContext,
): Promise<{
  assignments: { some: { OR: Record<string, unknown>[] } };
  OR: Record<string, unknown>[];
}> {
  const me = await client.membership.findUniqueOrThrow({
    where: { id: actor.membershipId },
    select: { level: true, groupId: true },
  });
  return {
    assignments: {
      some: {
        OR: [
          { clientMembershipId: actor.membershipId },
          ...(me.groupId ? [{ groupId: me.groupId }] : []),
          ...(me.level ? [{ level: me.level }] : []),
        ],
      },
    },
    OR: [
      { kind: { in: ['pdf', 'image'] } },
      { video: { status: 'ready', reviewStatus: 'approved' } },
    ],
  };
}
