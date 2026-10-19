import { Injectable } from '@nestjs/common';
import { AccessTokenService } from '../../../shared/auth/access-token.service';
import { TenantPrismaService } from '../../../shared/database/tenant-prisma.service';
import { ActiveMembershipFinder } from '../../../shared/tenancy/active-membership.finder';
import { buildConnectionKey } from '../domain/realtime-rules';

/**
 * Quién es la persona que se identifica y qué conversaciones puede oír: sus propias claves y las de
 * los hijos de los que es tutora. Es la misma comprobación que hacen los guards de la API: token
 * válido y membresía activa en ese centro.
 */
@Injectable()
export class RealtimeAuthenticator {
  constructor(
    private readonly accessTokens: AccessTokenService,
    private readonly memberships: ActiveMembershipFinder,
    private readonly tenantPrismaService: TenantPrismaService,
  ) {}

  /** Las claves de conexión de esa persona; lanza si el token no vale o no pertenece al centro. */
  async resolveConnectionKeys(input: { accessToken: string; centerId: string }): Promise<string[]> {
    const { userId } = await this.accessTokens.verify(input.accessToken);
    const membership = await this.memberships.find(userId, input.centerId);
    if (!membership) throw new Error('not a member of the center');
    const childIds = await this.findChildMembershipIds({
      userId,
      centerId: input.centerId,
      membershipId: membership.membershipId,
    });
    return [membership.membershipId, ...childIds].map((membershipId) =>
      buildConnectionKey({ centerId: input.centerId, membershipId }),
    );
  }

  /** Los hijos de los que es tutora: se lee con su propio contexto, que la RLS limita a sus enlaces. */
  private async findChildMembershipIds(guardian: {
    userId: string;
    centerId: string;
    membershipId: string;
  }): Promise<string[]> {
    const links = await this.tenantPrismaService.runInTenantContext(
      { ...guardian, role: 'client', permissions: [] },
      (client) =>
        client.guardianLink.findMany({
          where: { guardianMembershipId: guardian.membershipId },
          select: { childMembershipId: true },
        }),
    );
    return links.map(({ childMembershipId }) => childMembershipId);
  }
}
