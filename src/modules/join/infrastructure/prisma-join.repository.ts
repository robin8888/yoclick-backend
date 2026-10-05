import { Injectable } from '@nestjs/common';
import { v7 as generateUuidV7 } from 'uuid';
import { buildCenterLogoUrl } from '../../../shared/media/center-logo-url';
import {
  TenantPrismaService,
  type TenantTransactionClient,
} from '../../../shared/database/tenant-prisma.service';
import {
  type JoinCommand,
  type JoinOutcome,
  type JoinRepository,
  type ListedCenter,
  type PublicCenterSummary,
} from '../application/ports/join.repository';
import { decideJoin, type JoinFacts } from '../domain/join-decision';

const PUBLIC_CENTER_FIELDS = {
  id: true,
  name: true,
  slug: true,
  sectorId: true,
  brandColor: true,
  city: true,
  logoUpdatedAt: true,
} as const;

interface PublicCenterRow {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly sectorId: string;
  readonly brandColor: string;
  readonly city: string | null;
  readonly logoUpdatedAt: Date | null;
}

function toPublicCenterSummary(row: PublicCenterRow): PublicCenterSummary {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    sectorId: row.sectorId,
    brandColor: row.brandColor,
    city: row.city,
    logoUrl: buildCenterLogoUrl(row.id, row.logoUpdatedAt),
  };
}

@Injectable()
export class PrismaJoinRepository implements JoinRepository {
  constructor(private readonly tenantPrismaService: TenantPrismaService) {}

  async findCenterByJoinCode(joinCode: string): Promise<PublicCenterSummary | null> {
    const center = await this.tenantPrismaService.runInCenterLookupContext({ joinCode }, (client) =>
      client.center.findUnique({ where: { joinCode }, select: PUBLIC_CENTER_FIELDS }),
    );
    return center ? toPublicCenterSummary(center) : null;
  }

  async listListedCenters(textQuery: string | null, limit: number): Promise<ListedCenter[]> {
    const centers = await this.tenantPrismaService.runInCenterLookupContext(
      { isDirectory: true },
      (client) =>
        client.center.findMany({
          where: {
            isListed: true,
            status: { not: 'suspended' },
            ...(textQuery && {
              OR: [
                { name: { contains: textQuery, mode: 'insensitive' } },
                { city: { contains: textQuery, mode: 'insensitive' } },
              ],
            }),
          },
          select: { ...PUBLIC_CENTER_FIELDS, latitude: true, longitude: true },
          orderBy: { name: 'asc' },
          take: limit,
        }),
    );
    return centers.map(({ latitude, longitude, ...row }) => ({
      ...toPublicCenterSummary(row),
      latitude,
      longitude,
    }));
  }

  async joinAsClient(command: JoinCommand): Promise<JoinOutcome> {
    const { userId, centerId } = command;
    // El contexto es el del centro al que se une, con el rol que va a tener: cliente. Las políticas
    // de aislamiento permiten leer ese centro y escribir SU membresía, y nada de ningún otro.
    const actor = { userId, centerId, membershipId: '', role: 'client', permissions: [] } as const;
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      // Bloquear la fila del centro serializa a quienes se unen a la vez: el tope no se salta.
      const lockedCenters = await client.$queryRaw<{ id: string }[]>`
        select id from centers where id = ${centerId}::uuid for update`;
      if (lockedCenters.length === 0) return { decision: 'center_not_joinable', membership: null };
      return this.decideAndApply(client, command);
    });
  }

  private async decideAndApply(
    client: TenantTransactionClient,
    command: JoinCommand,
  ): Promise<JoinOutcome> {
    const { userId, centerId, presentedJoinCode } = command;
    const center = await client.center.findUniqueOrThrow({ where: { id: centerId } });
    const existing = await client.membership.findUnique({
      where: { centerId_userId: { centerId, userId } },
    });
    const activeClientCount = await client.membership.count({
      where: { centerId, role: 'client', status: 'active' },
    });
    const facts: JoinFacts = {
      center,
      presentedJoinCode,
      existingMembership: existing,
      activeClientCount,
    };

    const decision = decideJoin(facts);
    switch (decision) {
      case 'create_membership': {
        const created = await client.membership.create({
          data: { id: generateUuidV7(), centerId, userId, role: 'client', status: 'active' },
        });
        return { decision, membership: created };
      }
      case 'reactivate_membership': {
        // Quien volvió a unirse lo hace como cliente: dejar el cargo de antes no lo restituye.
        const reactivated = await client.membership.update({
          where: { centerId_userId: { centerId, userId } },
          data: { status: 'active', role: 'client' },
        });
        return { decision, membership: reactivated };
      }
      case 'already_member':
        return { decision, membership: existing };
      default:
        return { decision, membership: null };
    }
  }
}
