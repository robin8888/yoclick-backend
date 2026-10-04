import { Injectable } from '@nestjs/common';
import { v7 as generateUuidV7 } from 'uuid';
import { TenantPrismaService } from '../../../shared/database/tenant-prisma.service';
import {
  type MfaConfirmation,
  type MfaFactorState,
  type MfaRepository,
} from '../application/ports/mfa.repository';

@Injectable()
export class PrismaMfaRepository implements MfaRepository {
  constructor(private readonly tenantPrismaService: TenantPrismaService) {}

  async findFactor(userId: string): Promise<MfaFactorState | null> {
    const factor = await this.tenantPrismaService.runInUserContext(userId, (client) =>
      client.mfaFactor.findUnique({ where: { userId } }),
    );
    if (!factor) return null;
    return {
      encryptedSecret: factor.secretEncrypted,
      isConfirmed: factor.confirmedAt !== null,
      lastUsedStep: factor.lastUsedStep === null ? null : Number(factor.lastUsedStep),
    };
  }

  async saveUnconfirmedFactor(userId: string, encryptedSecret: string): Promise<boolean> {
    return this.tenantPrismaService.runInUserContext(userId, async (client) => {
      const existing = await client.mfaFactor.findUnique({ where: { userId } });
      if (existing?.confirmedAt) return false;

      await client.mfaFactor.upsert({
        where: { userId },
        create: { id: generateUuidV7(), userId, secretEncrypted: encryptedSecret },
        update: { secretEncrypted: encryptedSecret, lastUsedStep: null, confirmedAt: null },
      });
      return true;
    });
  }

  async confirmFactor(userId: string, confirmation: MfaConfirmation): Promise<boolean> {
    return this.tenantPrismaService.runInUserContext(userId, async (client) => {
      // El UPDATE condicional decide: solo una petición confirma un factor que aún no lo estaba.
      const confirmed = await client.mfaFactor.updateMany({
        where: { userId, confirmedAt: null },
        data: { confirmedAt: new Date(), lastUsedStep: BigInt(confirmation.step) },
      });
      if (confirmed.count !== 1) return false;

      await client.mfaRecoveryCode.deleteMany({ where: { userId } });
      await client.mfaRecoveryCode.createMany({
        data: confirmation.recoveryCodeHashes.map((codeHash) => ({
          id: generateUuidV7(),
          userId,
          codeHash,
        })),
      });
      return true;
    });
  }

  async markStepUsed(userId: string, step: number): Promise<boolean> {
    const result = await this.tenantPrismaService.runInUserContext(userId, (client) =>
      // Una sola sentencia: acepta el intervalo solo si es posterior al último. Sin carrera posible.
      client.mfaFactor.updateMany({
        where: {
          userId,
          confirmedAt: { not: null },
          OR: [{ lastUsedStep: null }, { lastUsedStep: { lt: BigInt(step) } }],
        },
        data: { lastUsedStep: BigInt(step) },
      }),
    );
    return result.count === 1;
  }

  async consumeRecoveryCode(userId: string, codeHash: string, usedAt: Date): Promise<boolean> {
    const result = await this.tenantPrismaService.runInUserContext(userId, (client) =>
      client.mfaRecoveryCode.updateMany({
        where: { userId, codeHash, usedAt: null },
        data: { usedAt },
      }),
    );
    return result.count === 1;
  }

  async replaceRecoveryCodes(userId: string, codeHashes: readonly string[]): Promise<void> {
    await this.tenantPrismaService.runInUserContext(userId, async (client) => {
      await client.mfaRecoveryCode.deleteMany({ where: { userId } });
      await client.mfaRecoveryCode.createMany({
        data: codeHashes.map((codeHash) => ({ id: generateUuidV7(), userId, codeHash })),
      });
    });
  }

  async countUnusedRecoveryCodes(userId: string): Promise<number> {
    return this.tenantPrismaService.runInUserContext(userId, (client) =>
      client.mfaRecoveryCode.count({ where: { userId, usedAt: null } }),
    );
  }

  async deleteFactor(userId: string): Promise<void> {
    await this.tenantPrismaService.runInUserContext(userId, async (client) => {
      await client.mfaRecoveryCode.deleteMany({ where: { userId } });
      await client.mfaFactor.deleteMany({ where: { userId } });
    });
  }

  async holdsAdministrativeRole(userId: string): Promise<boolean> {
    const count = await this.tenantPrismaService.runInUserContext(userId, (client) =>
      client.membership.count({
        where: { userId, role: { in: ['owner', 'admin'] }, status: 'active' },
      }),
    );
    return count > 0;
  }
}
