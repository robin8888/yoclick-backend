import { Injectable } from '@nestjs/common';
import { v7 as generateUuidV7 } from 'uuid';
import { TenantPrismaService } from '../../../shared/database/tenant-prisma.service';
import {
  type ActiveVerificationCode,
  type CodeReference,
  type NewVerificationCode,
  type VerificationCodeRepository,
  type VerificationPurposeName,
} from '../application/ports/verification-code.repository';

@Injectable()
export class PrismaVerificationCodeRepository implements VerificationCodeRepository {
  constructor(private readonly tenantPrismaService: TenantPrismaService) {}

  async replaceActiveCode(newCode: NewVerificationCode): Promise<void> {
    await this.tenantPrismaService.runInUserContext(newCode.userId, async (client) => {
      // Solo vale el último código: los anteriores quedan consumidos en la misma transacción.
      await client.verificationCode.updateMany({
        where: { userId: newCode.userId, purpose: newCode.purpose, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      await client.verificationCode.create({
        data: {
          id: generateUuidV7(),
          userId: newCode.userId,
          purpose: newCode.purpose,
          codeHash: newCode.codeHash,
          expiresAt: newCode.expiresAt,
        },
      });
    });
  }

  async findActiveCode(
    userId: string,
    purpose: VerificationPurposeName,
    now: Date,
  ): Promise<ActiveVerificationCode | null> {
    return this.tenantPrismaService.runInUserContext(userId, (client) =>
      client.verificationCode.findFirst({
        where: { userId, purpose, consumedAt: null, expiresAt: { gt: now } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, codeHash: true, createdAt: true },
      }),
    );
  }

  async registerAttempt(reference: CodeReference): Promise<number> {
    // `increment` se traduce en un UPDATE atómico (attempt_count = attempt_count + 1): sin carreras.
    const updated = await this.tenantPrismaService.runInUserContext(reference.userId, (client) =>
      client.verificationCode.update({
        where: { id: reference.codeId },
        data: { attemptCount: { increment: 1 } },
        select: { attemptCount: true },
      }),
    );
    return updated.attemptCount;
  }

  async consume(reference: CodeReference, consumedAt: Date): Promise<boolean> {
    const result = await this.tenantPrismaService.runInUserContext(reference.userId, (client) =>
      client.verificationCode.updateMany({
        where: { id: reference.codeId, consumedAt: null },
        data: { consumedAt },
      }),
    );
    return result.count === 1;
  }
}
