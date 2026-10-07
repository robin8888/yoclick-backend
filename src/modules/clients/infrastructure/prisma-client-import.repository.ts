import { Injectable } from '@nestjs/common';
import { v7 as generateUuidV7 } from 'uuid';
import {
  TenantPrismaService,
  type TenantTransactionClient,
} from '../../../shared/database/tenant-prisma.service';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import {
  type ClientImportRepository,
  type ImportedRowResult,
  type ImportRowOutcome,
} from '../application/ports/client-import.repository';
import {
  decideImportRowAction,
  type ImportRow,
  type ImportRowAction,
  UNUSABLE_PASSWORD_HASH,
} from '../domain/client-import-rules';

const OUTCOME_BY_REFUSAL: Readonly<
  Record<Exclude<ImportRowAction, 'add_as_client' | 'update_existing_client'>, ImportRowOutcome>
> = {
  blocked: 'blocked',
  team_member: 'team_member',
  client_limit_reached: 'client_limit_reached',
};

interface ImportContext {
  readonly centerId: string;
  /** Plazas que quedan en el plan; `null` si no tiene tope. Baja con cada cliente nuevo. */
  remainingSeats: number | null;
}

@Injectable()
export class PrismaClientImportRepository implements ClientImportRepository {
  constructor(private readonly tenantPrismaService: TenantPrismaService) {}

  async importClients(
    actor: ActorContext,
    rows: readonly ImportRow[],
  ): Promise<readonly ImportedRowResult[]> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      await client.$queryRaw`select id from centers where id = ${actor.centerId}::uuid for update`;
      const context: ImportContext = {
        centerId: actor.centerId,
        remainingSeats: await this.countRemainingSeats(client, actor.centerId),
      };
      const results: ImportedRowResult[] = [];
      for (const row of rows) {
        const outcome = await this.importRow(client, context, row);
        results.push({ email: row.email ?? '', outcome });
      }
      return results;
    });
  }

  private async countRemainingSeats(
    client: TenantTransactionClient,
    centerId: string,
  ): Promise<number | null> {
    const center = await client.center.findUniqueOrThrow({
      where: { id: centerId },
      select: { maxClients: true },
    });
    if (center.maxClients === null) return null;
    const activeClientCount = await client.membership.count({
      where: { centerId, role: 'client', status: 'active' },
    });
    return Math.max(center.maxClients - activeClientCount, 0);
  }

  private async importRow(
    client: TenantTransactionClient,
    context: ImportContext,
    row: ImportRow,
  ): Promise<ImportRowOutcome> {
    const user = await client.user.findUnique({
      where: { email: row.email ?? '' },
      select: { id: true },
    });
    const membership = user
      ? await client.membership.findUnique({
          where: { centerId_userId: { centerId: context.centerId, userId: user.id } },
        })
      : null;

    const action = decideImportRowAction({ membership, remainingSeats: context.remainingSeats });
    if (action === 'update_existing_client') {
      if (membership) await this.updateLevel(client, membership.id, row);
      return 'updated';
    }
    if (action !== 'add_as_client') return OUTCOME_BY_REFUSAL[action];

    const userId = user?.id ?? (await this.createUnactivatedAccount(client, row));
    await this.activateClientMembership(client, { context, userId, membership, row });
    if (context.remainingSeats !== null) context.remainingSeats -= 1;
    return 'created';
  }

  private async updateLevel(
    client: TenantTransactionClient,
    membershipId: string,
    row: ImportRow,
  ): Promise<void> {
    if (!row.level) return;
    await client.membership.update({ where: { id: membershipId }, data: { level: row.level } });
  }

  /** Sin contraseña utilizable ni correo verificado: la persona la reclama cuando se registre. */
  private async createUnactivatedAccount(
    client: TenantTransactionClient,
    row: ImportRow,
  ): Promise<string> {
    const userId = generateUuidV7();
    await client.user.create({
      data: {
        id: userId,
        email: row.email ?? '',
        fullName: row.fullName,
        phone: row.phone,
        passwordHash: UNUSABLE_PASSWORD_HASH,
      },
    });
    return userId;
  }

  private async activateClientMembership(
    client: TenantTransactionClient,
    request: {
      context: ImportContext;
      userId: string;
      membership: { id: string } | null;
      row: ImportRow;
    },
  ): Promise<void> {
    const { context, userId, membership, row } = request;
    if (membership) {
      await client.membership.update({
        where: { id: membership.id },
        data: { status: 'active', ...(row.level && { level: row.level }) },
      });
      return;
    }
    await client.membership.create({
      data: {
        id: generateUuidV7(),
        centerId: context.centerId,
        userId,
        role: 'client',
        status: 'active',
        level: row.level,
      },
    });
  }
}
