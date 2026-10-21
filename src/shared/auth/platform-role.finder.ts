import { Injectable } from '@nestjs/common';
import { TenantPrismaService } from '../database/tenant-prisma.service';
import { type PlatformRoleName } from './authenticated-request';

/**
 * El rol de plataforma de una persona. Se lee con el contexto de la propia persona (`users` no tiene RLS
 * y el rol nunca viaja en el token), así que revocarlo surte efecto en la siguiente petición.
 */
@Injectable()
export class PlatformRoleFinder {
  constructor(private readonly tenantPrismaService: TenantPrismaService) {}

  async find(userId: string): Promise<PlatformRoleName | null> {
    const user = await this.tenantPrismaService.runInUserContext(userId, (client) =>
      client.user.findUnique({
        where: { id: userId },
        select: { platformRole: true, deletedAt: true },
      }),
    );
    if (user === null || user.deletedAt !== null || user.platformRole === 'none') return null;
    return user.platformRole;
  }
}
