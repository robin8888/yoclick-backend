import { Injectable } from '@nestjs/common';
import { TenantPrismaService } from '../../../shared/database/tenant-prisma.service';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import {
  type MemberPhotoRemoval,
  type PhotoRepository,
} from '../application/ports/photo.repository';

@Injectable()
export class PrismaPhotoRepository implements PhotoRepository {
  constructor(private readonly tenantPrismaService: TenantPrismaService) {}

  async replaceAvatar(
    userId: string,
    newKey: string,
  ): Promise<{ previousKey: string | null } | null> {
    return this.tenantPrismaService.runInUserContext(userId, async (client) => {
      const user = await client.user.findFirst({
        where: { id: userId, deletedAt: null },
        select: { photoKey: true },
      });
      if (!user) return null;
      await client.user.update({ where: { id: userId }, data: { photoKey: newKey } });
      return { previousKey: user.photoKey };
    });
  }

  async removeAvatar(userId: string): Promise<string | null> {
    return this.tenantPrismaService.runInUserContext(userId, async (client) => {
      const user = await client.user.findFirst({
        where: { id: userId, deletedAt: null },
        select: { photoKey: true },
      });
      if (!user?.photoKey) return null;
      await client.user.update({ where: { id: userId }, data: { photoKey: null } });
      return user.photoKey;
    });
  }

  async removeMemberAvatar(actor: ActorContext, membershipId: string): Promise<MemberPhotoRemoval> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      // La RLS acota a este centro: la membresía de otro centro no se encuentra.
      const member = await client.membership.findUnique({
        where: { id: membershipId },
        select: { user: { select: { id: true, photoKey: true } } },
      });
      if (!member) return { kind: 'not_found' } as const;
      if (member.user.photoKey !== null) {
        await client.user.update({ where: { id: member.user.id }, data: { photoKey: null } });
      }
      return { kind: 'removed', previousKey: member.user.photoKey } as const;
    });
  }
}
