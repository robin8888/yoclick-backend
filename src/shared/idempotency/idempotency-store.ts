export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [property: string]: JsonValue };

export interface StoredResponse {
  readonly status: number;
  readonly body: JsonValue;
}

export interface ClaimRequest {
  readonly userId: string;
  readonly key: string;
  readonly operation: string;
  readonly requestFingerprint: string;
  readonly now: Date;
  /** Hasta cuándo se recuerda esta clave. */
  readonly expiresAt: Date;
  /** Una clave "en curso" creada antes de este instante se considera abandonada (el proceso murió). */
  readonly staleBefore: Date;
}

export type ClaimResult =
  | { readonly kind: 'execute' }
  | { readonly kind: 'replay'; readonly response: StoredResponse }
  | { readonly kind: 'fingerprint-mismatch' }
  | { readonly kind: 'in-progress' };

export interface KeyReference {
  readonly userId: string;
  readonly key: string;
}

/** Puerto de almacenamiento. Hoy PostgreSQL; si se pasa a Redis, solo cambia la implementación. */
export interface IdempotencyStore {
  /** Atómico: como mucho UNA petición concurrente recibe `execute` para una misma clave. */
  claim(request: ClaimRequest): Promise<ClaimResult>;
  complete(reference: KeyReference, response: StoredResponse): Promise<void>;
  /** Libera la clave tras un fallo: no se hizo nada, así que el cliente puede reintentar. */
  release(reference: KeyReference): Promise<void>;
}

export const IDEMPOTENCY_STORE = Symbol('IDEMPOTENCY_STORE');
