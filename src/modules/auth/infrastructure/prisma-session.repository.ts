import { Injectable } from '@nestjs/common';
import { TenantPrismaService } from '../../../shared/database/tenant-prisma.service';
import {
  type NewRefreshToken,
  type RotationRequest,
  type SessionRepository,
  type StoredRefreshToken,
} from '../application/ports/session.repository';

/**
 * Sesiones en PostgreSQL. `refresh_tokens` no tiene RLS (se consulta por el hash del propio token,
 * antes de saber quién es la persona), así que se usa el contexto público.
 */
@Injectable()
export class PrismaSessionRepository implements SessionRepository {
  constructor(private readonly tenantPrismaService: TenantPrismaService) {}

  async create(newToken: NewRefreshToken): Promise<void> {
    await this.tenantPrismaService.runInPublicContext((client) =>
      client.refreshToken.create({
        data: {
          id: newToken.id,
          userId: newToken.userId,
          familyId: newToken.familyId,
          tokenHash: newToken.tokenHash,
          deviceName: newToken.deviceName,
          mfaVerified: newToken.isMfaVerified,
          expiresAt: newToken.expiresAt,
        },
      }),
    );
  }

  async findByTokenHash(tokenHash: string): Promise<StoredRefreshToken | null> {
    const stored = await this.tenantPrismaService.runInPublicContext((client) =>
      client.refreshToken.findUnique({
        where: { tokenHash },
        select: {
          id: true,
          userId: true,
          familyId: true,
          expiresAt: true,
          revokedAt: true,
          mfaVerified: true,
        },
      }),
    );
    if (!stored) return null;
    const { mfaVerified: wasMfaVerified, ...rest } = stored;
    return { ...rest, isMfaVerified: wasMfaVerified };
  }

  async rotate(request: RotationRequest): Promise<boolean> {
    return this.tenantPrismaService.runInPublicContext(async (client) => {
      // El UPDATE condicional es lo que decide la carrera: solo una petición lo consigue.
      const revocation = await client.refreshToken.updateMany({
        where: { id: request.currentTokenId, revokedAt: null },
        data: { revokedAt: request.now, replacedById: request.newToken.id },
      });
      if (revocation.count !== 1) return false;

      await client.refreshToken.create({
        data: {
          id: request.newToken.id,
          userId: request.newToken.userId,
          familyId: request.newToken.familyId,
          tokenHash: request.newToken.tokenHash,
          deviceName: request.newToken.deviceName,
          mfaVerified: request.newToken.isMfaVerified,
          expiresAt: request.newToken.expiresAt,
        },
      });
      return true;
    });
  }

  async revokeFamily(familyId: string, now: Date): Promise<void> {
    await this.tenantPrismaService.runInPublicContext((client) =>
      client.refreshToken.updateMany({
        where: { familyId, revokedAt: null },
        data: { revokedAt: now },
      }),
    );
  }

  async revokeAllOfUser(userId: string, now: Date): Promise<void> {
    await this.tenantPrismaService.runInPublicContext((client) =>
      client.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now },
      }),
    );
  }
}
