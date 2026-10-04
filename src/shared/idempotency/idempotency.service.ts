import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '../errors/domain-error';
import { HTTP_STATUS } from '../errors/http-status';
import {
  IDEMPOTENCY_STORE,
  type ClaimResult,
  type IdempotencyStore,
  type JsonValue,
  type StoredResponse,
} from './idempotency-store';
import { computeRequestFingerprint } from './request-fingerprint';
import { MILLISECONDS_PER_HOUR, MILLISECONDS_PER_MINUTE } from '../time/time-units';

const KEY_RETENTION_HOURS = 24;
const KEY_RETENTION_MS = KEY_RETENTION_HOURS * MILLISECONDS_PER_HOUR;
/** Mayor que el timeout de una transacción (10 s): pasado este tiempo, el proceso original ya no sigue vivo. */
const STALE_LOCK_MS = MILLISECONDS_PER_MINUTE;

export interface IdempotentRequest {
  readonly userId: string;
  readonly key: string;
  /** Por ejemplo `POST /v1/bookings`. Forma parte de la huella: una clave no vale para otro endpoint. */
  readonly operation: string;
  readonly requestBody: unknown;
  readonly work: () => Promise<StoredResponse>;
}

export type IdempotentOutcome = StoredResponse & { readonly wasReplayed: boolean };

/**
 * Hace que repetir una operación con la misma `Idempotency-Key` no repita su efecto: un reintento
 * por mala cobertura no debe cobrar dos veces ni reservar dos plazas.
 */
@Injectable()
export class IdempotencyService {
  constructor(@Inject(IDEMPOTENCY_STORE) private readonly store: IdempotencyStore) {}

  async execute(request: IdempotentRequest): Promise<IdempotentOutcome> {
    const reference = { userId: request.userId, key: request.key };
    const claim = await this.claim(request);
    const replayedResponse = this.interpretClaim(claim);
    if (replayedResponse) return { ...replayedResponse, wasReplayed: true };

    const response = await this.runWorkReleasingKeyOnFailure(request, reference);
    await this.store.complete(reference, response);
    return { ...response, wasReplayed: false };
  }

  private async claim(request: IdempotentRequest): Promise<ClaimResult> {
    const now = new Date();
    return this.store.claim({
      userId: request.userId,
      key: request.key,
      operation: request.operation,
      requestFingerprint: computeRequestFingerprint(request.operation, request.requestBody),
      now,
      expiresAt: new Date(now.getTime() + KEY_RETENTION_MS),
      staleBefore: new Date(now.getTime() - STALE_LOCK_MS),
    });
  }

  /** Devuelve la respuesta guardada si es un reintento, `undefined` si hay que ejecutar, o lanza. */
  private interpretClaim(claim: ClaimResult): StoredResponse | undefined {
    switch (claim.kind) {
      case 'execute':
        return undefined;
      case 'replay':
        return claim.response;
      case 'fingerprint-mismatch':
        throw new DomainError('IDEMPOTENCY_KEY_REUSED', HTTP_STATUS.unprocessableEntity);
      case 'in-progress':
        throw new DomainError('IDEMPOTENCY_IN_PROGRESS', HTTP_STATUS.conflict);
    }
  }

  private async runWorkReleasingKeyOnFailure(
    request: IdempotentRequest,
    reference: { userId: string; key: string },
  ): Promise<StoredResponse> {
    try {
      return await request.work();
    } catch (error) {
      await this.store.release(reference);
      throw error;
    }
  }
}

export type { JsonValue };
