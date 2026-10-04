import { v7 as generateUuidV7 } from 'uuid';
import { type PrismaService } from '../../src/shared/database/prisma.service';
import { type TenantPrismaService } from '../../src/shared/database/tenant-prisma.service';
import { type ActorContext, type MembershipRoleName } from '../../src/shared/tenancy/actor-context';

type MembershipStatusName = 'invited' | 'active' | 'blocked' | 'left';

/** Datos de prueba creados con el mismo camino (y la misma RLS) que usará la aplicación. */
export class DatabaseFixtures {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly tenantPrismaService: TenantPrismaService,
  ) {}

  async createUser(emailPrefix: string): Promise<string> {
    const userId = generateUuidV7();
    await this.prismaService.user.create({
      data: {
        id: userId,
        email: `${emailPrefix}@example.test`,
        passwordHash: 'not-a-real-hash',
        fullName: emailPrefix,
      },
    });
    return userId;
  }

  async createCenter(slug: string, joinCode: string): Promise<string> {
    const centerId = generateUuidV7();
    const ownerContext = this.buildActor(centerId, generateUuidV7(), 'owner');
    await this.tenantPrismaService.runInTenantContext(ownerContext, (client) =>
      client.center.create({
        data: {
          id: centerId,
          slug,
          name: slug,
          sectorId: 'gym',
          brandColor: '#E4572E',
          joinCode,
        },
      }),
    );
    return centerId;
  }

  async createMembership(input: {
    centerId: string;
    userId: string;
    role: MembershipRoleName;
    status?: MembershipStatusName;
  }): Promise<string> {
    const membershipId = generateUuidV7();
    const actor = this.buildActor(input.centerId, input.userId, input.role);
    await this.tenantPrismaService.runInTenantContext(actor, (client) =>
      client.membership.create({
        data: {
          id: membershipId,
          centerId: input.centerId,
          userId: input.userId,
          role: input.role,
          status: input.status ?? 'active',
        },
      }),
    );
    return membershipId;
  }

  private buildActor(centerId: string, userId: string, role: MembershipRoleName): ActorContext {
    return { userId, centerId, membershipId: generateUuidV7(), role, permissions: [] };
  }
}
