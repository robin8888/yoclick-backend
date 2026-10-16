import { Injectable } from '@nestjs/common';
import { TenantPrismaService } from '../database/tenant-prisma.service';

/**
 * Si una persona tiene el segundo factor activado. Se lee con el contexto de la propia persona, que la
 * RLS limita a su fila: no hay forma de mirar el factor de otra.
 */
@Injectable()
export class SecondFactorEnrollmentChecker {
  constructor(private readonly tenantPrismaService: TenantPrismaService) {}

  async hasConfirmedSecondFactor(userId: string): Promise<boolean> {
    const factor = await this.tenantPrismaService.runInUserContext(userId, (client) =>
      client.mfaFactor.findFirst({
        where: { userId, confirmedAt: { not: null } },
        select: { id: true },
      }),
    );
    return factor !== null;
  }
}
