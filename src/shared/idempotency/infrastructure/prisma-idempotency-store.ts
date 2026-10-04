import { Injectable } from '@nestjs/common';
import { v7 as generateUuidV7 } from 'uuid';
import { Prisma } from '../../../generated/prisma/client';
import {
  type TenantTransactionClient,
  TenantPrismaService,
} from '../../database/tenant-prisma.service';
import {
  type ClaimRequest,
  type ClaimResult,
  type IdempotencyStore,
  type JsonValue,
  type KeyReference,
  type StoredResponse,
} from '../idempotency-store';

const EXECUTE: ClaimResult = { kind: 'execute' };
const IN_PROGRESS: ClaimResult = { kind: 'in-progress' };

function toDatabaseJson(body: JsonValue): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return body === null ? Prisma.JsonNull : body;
}

/**
 * Almacén PostgreSQL de claves de idempotencia, con RLS por persona. Cada transición es una sola
 * sentencia condicional: así, entre peticiones concurrentes, solo una gana el derecho a ejecutar.
 */
@Injectable()
export class PrismaIdempotencyStore implements IdempotencyStore {
  constructor(private readonly tenantPrismaService: TenantPrismaService) {}

  async claim(request: ClaimRequest): Promise<ClaimResult> {
    return this.tenantPrismaService.runInUserContext(request.userId, (client) =>
      this.claimWithinTransaction(client, request),
    );
  }

  async complete(reference: KeyReference, response: StoredResponse): Promise<void> {
    await this.tenantPrismaService.runInUserContext(reference.userId, (client) =>
      client.idempotencyKey.update({
        where: { userId_key: { userId: reference.userId, key: reference.key } },
        data: {
          status: 'completed',
          responseStatus: response.status,
          responseBody: toDatabaseJson(response.body),
        },
      }),
    );
  }

  async release(reference: KeyReference): Promise<void> {
    await this.tenantPrismaService.runInUserContext(reference.userId, (client) =>
      client.idempotencyKey.deleteMany({
        where: { userId: reference.userId, key: reference.key },
      }),
    );
  }

  private async claimWithinTransaction(
    client: TenantTransactionClient,
    request: ClaimRequest,
  ): Promise<ClaimResult> {
    const insertion = await client.idempotencyKey.createMany({
      data: [
        {
          id: generateUuidV7(),
          userId: request.userId,
          key: request.key,
          operation: request.operation,
          requestFingerprint: request.requestFingerprint,
          expiresAt: request.expiresAt,
        },
      ],
      skipDuplicates: true,
    });
    if (insertion.count === 1) return EXECUTE;

    const existing = await client.idempotencyKey.findUnique({
      where: { userId_key: { userId: request.userId, key: request.key } },
    });
    // Desapareció entre medias (otra petición la liberó): que el cliente reintente.
    if (!existing) return IN_PROGRESS;

    if (existing.expiresAt <= request.now)
      return this.takeOverExpired(client, existing.id, request);
    if (existing.requestFingerprint !== request.requestFingerprint) {
      return { kind: 'fingerprint-mismatch' };
    }
    if (existing.status === 'completed') return this.toReplay(existing);
    return this.takeOverIfStale(client, existing, request);
  }

  private async takeOverExpired(
    client: TenantTransactionClient,
    keyRecordId: string,
    request: ClaimRequest,
  ): Promise<ClaimResult> {
    const takeover = await client.idempotencyKey.updateMany({
      where: { id: keyRecordId, expiresAt: { lte: request.now } },
      data: {
        operation: request.operation,
        requestFingerprint: request.requestFingerprint,
        status: 'in_progress',
        responseStatus: null,
        responseBody: Prisma.DbNull,
        createdAt: request.now,
        expiresAt: request.expiresAt,
      },
    });
    return takeover.count === 1 ? EXECUTE : IN_PROGRESS;
  }

  private async takeOverIfStale(
    client: TenantTransactionClient,
    existing: { id: string; createdAt: Date },
    request: ClaimRequest,
  ): Promise<ClaimResult> {
    if (existing.createdAt >= request.staleBefore) return IN_PROGRESS;

    const takeover = await client.idempotencyKey.updateMany({
      where: { id: existing.id, status: 'in_progress', createdAt: { lt: request.staleBefore } },
      data: { createdAt: request.now },
    });
    return takeover.count === 1 ? EXECUTE : IN_PROGRESS;
  }

  private toReplay(existing: {
    responseStatus: number | null;
    responseBody: Prisma.JsonValue | null;
  }): ClaimResult {
    if (existing.responseStatus === null) return IN_PROGRESS;
    return {
      kind: 'replay',
      response: { status: existing.responseStatus, body: existing.responseBody as JsonValue },
    };
  }
}
