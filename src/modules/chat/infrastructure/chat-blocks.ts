import { type TenantTransactionClient } from '../../../shared/database/tenant-prisma.service';
import { type ActorContext } from '../../../shared/tenancy/actor-context';

/**
 * Las personas con las que quien pregunta tiene un bloqueo, lo haya puesto él o la otra persona. La seguridad
 * por filas deja ver a cada una los bloqueos en los que participa, así que no hace falta filtrar más.
 * Sirve para impedir hablar y para no ofrecer a esas personas como contacto; nunca se muestra el motivo.
 */
export async function findBlockPartnerIds(
  client: TenantTransactionClient,
  actor: ActorContext,
): Promise<ReadonlySet<string>> {
  const blocks = await client.chatBlock.findMany({
    select: { blockerMembershipId: true, blockedMembershipId: true },
  });
  return new Set(
    blocks.map(({ blockerMembershipId, blockedMembershipId }) =>
      blockerMembershipId === actor.membershipId ? blockedMembershipId : blockerMembershipId,
    ),
  );
}

/** Las personas a las que ha bloqueado quien pregunta: sus conversaciones se le esconden. */
export async function findIdsBlockedBy(
  client: TenantTransactionClient,
  actor: ActorContext,
): Promise<string[]> {
  const blocks = await client.chatBlock.findMany({
    where: { blockerMembershipId: actor.membershipId },
    select: { blockedMembershipId: true },
  });
  return blocks.map(({ blockedMembershipId }) => blockedMembershipId);
}
