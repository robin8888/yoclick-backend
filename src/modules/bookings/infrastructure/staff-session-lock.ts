import { type TenantTransactionClient } from '../../../shared/database/tenant-prisma.service';

/** Un cerrojo por persona del equipo y transacción: dos «iniciar» suyos a la vez se atienden de uno en uno. */
export async function lockStaffSessions(
  client: TenantTransactionClient,
  staffMembershipId: string,
): Promise<void> {
  await client.$executeRaw`select pg_advisory_xact_lock(hashtextextended(${staffMembershipId}, 0))`;
}
