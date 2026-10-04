import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { TenantPrismaService } from '../../../shared/database/tenant-prisma.service';
import { type AccountErasureRepository } from '../application/ports/account-erasure.repository';

const UNUSABLE_PASSWORD_BYTES = 32;
/** `.invalid` es un dominio reservado (RFC 2606): este correo no puede recibir nada ni coincidir con nadie. */
const ERASED_EMAIL_DOMAIN = 'deleted.invalid';
const ERASED_FULL_NAME = 'Usuario eliminado';

@Injectable()
export class PrismaAccountErasureRepository implements AccountErasureRepository {
  constructor(private readonly tenantPrismaService: TenantPrismaService) {}

  async ownsActiveCenter(userId: string): Promise<boolean> {
    const ownedCenterCount = await this.tenantPrismaService.runInUserContext(userId, (client) =>
      client.membership.count({ where: { userId, role: 'owner', status: 'active' } }),
    );
    return ownedCenterCount > 0;
  }

  async anonymize(userId: string, erasedAt: Date): Promise<void> {
    await this.tenantPrismaService.runInUserContext(userId, async (client) => {
      await client.user.update({
        where: { id: userId },
        data: {
          email: `deleted-${userId}@${ERASED_EMAIL_DOMAIN}`,
          fullName: ERASED_FULL_NAME,
          phone: null,
          birthDate: null,
          // Un valor que no es un hash válido: ninguna contraseña lo verifica.
          passwordHash: `erased:${randomBytes(UNUSABLE_PASSWORD_BYTES).toString('hex')}`,
          emailVerifiedAt: null,
          failedLoginCount: 0,
          lockedUntil: null,
          deletedAt: erasedAt,
        },
      });
      await client.verificationCode.deleteMany({ where: { userId } });
      await client.idempotencyKey.deleteMany({ where: { userId } });
      await client.refreshToken.deleteMany({ where: { userId } });
      // Sale de todos los centros. Los consentimientos se conservan como prueba legal, ya sin
      // ningún dato identificable que los acompañe.
      await client.membership.updateMany({
        where: { userId, status: { not: 'left' } },
        data: { status: 'left' },
      });
    });
  }
}
