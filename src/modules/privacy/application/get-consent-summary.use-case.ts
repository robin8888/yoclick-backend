import { Injectable } from '@nestjs/common';
import { TenantPrismaService } from '../../../shared/database/tenant-prisma.service';
import { type ActorContext } from '../../../shared/tenancy/actor-context';

export interface ConsentSummary {
  /** Clientes activos del centro: el total sobre el que se cuentan los consentimientos. */
  readonly clientCount: number;
  readonly privacy: number;
  readonly health: number;
  readonly marketing: number;
  readonly image: number;
  readonly parental: number;
}

interface GrantedCountRow {
  readonly kind: string;
  readonly granted: number;
}

/**
 * Cuántos clientes activos del centro tienen concedido cada consentimiento. Cuenta el último
 * registro de cada persona y tipo: retirarlo después lo quita de la cuenta.
 */
@Injectable()
export class GetConsentSummaryUseCase {
  constructor(private readonly tenantPrismaService: TenantPrismaService) {}

  async execute(actor: ActorContext): Promise<ConsentSummary> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const clientCount = await client.membership.count({
        where: { centerId: actor.centerId, role: 'client', status: 'active' },
      });
      const rows = await client.$queryRaw<GrantedCountRow[]>`
        select kind::text as kind, count(*)::int as granted
        from (
          select distinct on (consent.user_id, consent.kind) consent.kind, consent.is_granted
          from consents consent
          join memberships client_membership
            on client_membership.user_id = consent.user_id
           and client_membership.center_id = ${actor.centerId}::uuid
           and client_membership.role = 'client'
           and client_membership.status = 'active'
          order by consent.user_id, consent.kind, consent.granted_at desc
        ) latest
        where is_granted
        group by kind`;
      const grantedOf = (kind: string): number =>
        rows.find((row) => row.kind === kind)?.granted ?? 0;
      return {
        clientCount,
        privacy: grantedOf('privacy'),
        health: grantedOf('health'),
        marketing: grantedOf('marketing'),
        image: grantedOf('image'),
        parental: grantedOf('parental'),
      };
    });
  }
}
