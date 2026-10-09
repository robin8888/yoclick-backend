import { v7 as generateUuidV7 } from 'uuid';
import { type TenantTransactionClient } from '../../../shared/database/tenant-prisma.service';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { type ClientLevelName } from '../../clients/domain/client-rules';
import { type ContentTarget } from '../domain/content-rules';

interface TargetColumns {
  readonly level: ClientLevelName | null;
  readonly groupId: string | null;
  readonly clientMembershipId: string | null;
}

async function isValidTarget(
  client: TenantTransactionClient,
  target: ContentTarget,
): Promise<boolean> {
  if (target.kind === 'level') return true;
  if (target.kind === 'client') {
    return (
      (await client.membership.count({
        where: { id: target.membershipId, role: 'client', status: 'active' },
      })) === 1
    );
  }
  return (
    (await client.clientGroup.count({ where: { id: target.groupId, archivedAt: null } })) === 1
  );
}

export async function areAllTargetsValid(
  client: TenantTransactionClient,
  targets: readonly ContentTarget[],
): Promise<boolean> {
  const checks = await Promise.all(targets.map((target) => isValidTarget(client, target)));
  return checks.every(Boolean);
}

function toTargetColumns(target: ContentTarget): TargetColumns {
  const none = { level: null, groupId: null, clientMembershipId: null };
  if (target.kind === 'level') return { ...none, level: target.level };
  if (target.kind === 'group') return { ...none, groupId: target.groupId };
  return { ...none, clientMembershipId: target.membershipId };
}

function describeTarget(columns: TargetColumns): string {
  return `${columns.level ?? ''}|${columns.groupId ?? ''}|${columns.clientMembershipId ?? ''}`;
}

/** A quién se enseña ahora la pieza, antes de sustituirlo: sirve para avisar solo a los nuevos. */
export async function readCurrentTargets(
  client: TenantTransactionClient,
  contentId: string,
): Promise<ContentTarget[]> {
  const rows = await client.contentAssignment.findMany({
    where: { contentId },
    select: { level: true, groupId: true, clientMembershipId: true },
  });
  return rows.flatMap((row): ContentTarget[] => {
    if (row.level !== null) return [{ kind: 'level', level: row.level }];
    if (row.groupId !== null) return [{ kind: 'group', groupId: row.groupId }];
    if (row.clientMembershipId === null) return [];
    return [{ kind: 'client', membershipId: row.clientMembershipId }];
  });
}

/** Sustituye las asignaciones de la pieza por las que llegan; repetir un destino no lo duplica. */
export async function replaceAssignmentRows(
  client: TenantTransactionClient,
  actor: ActorContext,
  request: { contentId: string; targets: readonly ContentTarget[] },
): Promise<void> {
  await client.contentAssignment.deleteMany({ where: { contentId: request.contentId } });
  const uniqueColumns = new Map(
    request.targets.map((target) => {
      const columns = toTargetColumns(target);
      return [describeTarget(columns), columns] as const;
    }),
  );
  await client.contentAssignment.createMany({
    data: [...uniqueColumns.values()].map((columns) => ({
      id: generateUuidV7(),
      centerId: actor.centerId,
      contentId: request.contentId,
      assignedByMembershipId: actor.membershipId,
      ...columns,
    })),
  });
}
