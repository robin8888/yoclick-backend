import { Injectable } from '@nestjs/common';
import { v7 as generateUuidV7 } from 'uuid';
import { Prisma } from '../../../generated/prisma/client';
import { TenantPrismaService } from '../../../shared/database/tenant-prisma.service';
import {
  type CreateUserAccountResult,
  type FailedLoginOutcome,
  type LockoutPolicy,
  type NewUserAccount,
  type UserAccount,
  type UserAccountRepository,
} from '../application/ports/user-account.repository';

const UNIQUE_CONSTRAINT_VIOLATION_CODE = 'P2002';

function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === UNIQUE_CONSTRAINT_VIOLATION_CODE
  );
}

@Injectable()
export class PrismaUserAccountRepository implements UserAccountRepository {
  constructor(private readonly tenantPrismaService: TenantPrismaService) {}

  async findByEmail(email: string): Promise<UserAccount | null> {
    // La tabla `users` no tiene RLS: se busca sin identidad porque aún no se sabe quién es.
    return this.tenantPrismaService.runInPublicContext((client) =>
      client.user.findUnique({
        where: { email },
        select: {
          id: true,
          email: true,
          fullName: true,
          passwordHash: true,
          emailVerifiedAt: true,
          failedLoginCount: true,
          lockedUntil: true,
        },
      }),
    );
  }

  async changePassword(userId: string, newPasswordHash: string, changedAt: Date): Promise<void> {
    await this.tenantPrismaService.runInUserContext(userId, async (client) => {
      const { emailVerifiedAt } = await client.user.findUniqueOrThrow({
        where: { id: userId },
        select: { emailVerifiedAt: true },
      });
      await client.user.update({
        where: { id: userId },
        data: {
          passwordHash: newPasswordHash,
          failedLoginCount: 0,
          lockedUntil: null,
          emailVerifiedAt: emailVerifiedAt ?? changedAt,
        },
      });
    });
  }

  async recordFailedLogin(userId: string, policy: LockoutPolicy): Promise<FailedLoginOutcome> {
    return this.tenantPrismaService.runInUserContext(userId, async (client) => {
      // El incremento es un UPDATE atómico y deja la fila bloqueada hasta el final de la transacción:
      // dos intentos simultáneos no pueden pasarse del límite ni bloquear dos veces.
      const { failedLoginCount } = await client.user.update({
        where: { id: userId },
        data: { failedLoginCount: { increment: 1 } },
        select: { failedLoginCount: true },
      });
      if (failedLoginCount < policy.maxFailedAttempts) return { isNowLocked: false };

      await client.user.update({
        where: { id: userId },
        data: {
          failedLoginCount: 0,
          lockedUntil: new Date(policy.now.getTime() + policy.lockDurationMs),
        },
      });
      return { isNowLocked: true };
    });
  }

  async recordSuccessfulLogin(
    userId: string,
    now: Date,
    upgradedPasswordHash?: string,
  ): Promise<void> {
    await this.tenantPrismaService.runInUserContext(userId, (client) =>
      client.user.update({
        where: { id: userId },
        data: {
          failedLoginCount: 0,
          lockedUntil: null,
          lastLoginAt: now,
          ...(upgradedPasswordHash && { passwordHash: upgradedPasswordHash }),
        },
      }),
    );
  }

  async create(newUser: NewUserAccount): Promise<CreateUserAccountResult> {
    try {
      // Cuenta y consentimientos en una sola transacción: no puede quedar una cuenta sin su prueba de consentimiento.
      await this.tenantPrismaService.runInUserContext(newUser.id, async (client) => {
        await client.user.create({
          data: {
            id: newUser.id,
            email: newUser.email,
            fullName: newUser.fullName,
            passwordHash: newUser.passwordHash,
          },
        });
        await client.consent.createMany({
          data: newUser.consents.map((consent) => ({
            id: generateUuidV7(),
            userId: newUser.id,
            kind: consent.kind,
            version: consent.version,
            isGranted: consent.isGranted,
            ipHash: newUser.ipHash,
          })),
        });
      });
      return 'created';
    } catch (error) {
      // Otra petición registró el mismo correo a la vez: la restricción única de la base de datos decide.
      if (isUniqueConstraintViolation(error)) return 'email-taken';
      throw error;
    }
  }

  async markEmailVerified(userId: string, verifiedAt: Date): Promise<void> {
    await this.tenantPrismaService.runInUserContext(userId, (client) =>
      client.user.update({ where: { id: userId }, data: { emailVerifiedAt: verifiedAt } }),
    );
  }
}
