export interface NewRefreshToken {
  readonly id: string;
  readonly userId: string;
  /** Todos los tokens descendientes de un mismo inicio de sesión comparten familia. */
  readonly familyId: string;
  readonly tokenHash: string;
  readonly deviceName: string | null;
  readonly expiresAt: Date;
}

export interface StoredRefreshToken {
  readonly id: string;
  readonly userId: string;
  readonly familyId: string;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
}

export interface RotationRequest {
  readonly currentTokenId: string;
  readonly newToken: NewRefreshToken;
  readonly now: Date;
}

export interface SessionRepository {
  create(newToken: NewRefreshToken): Promise<void>;
  findByTokenHash(tokenHash: string): Promise<StoredRefreshToken | null>;
  /**
   * Revoca el token actual y crea el siguiente en una sola operación atómica. Devuelve `false` si
   * el actual ya estaba revocado (otra petición lo usó antes): eso se trata como reutilización.
   */
  rotate(request: RotationRequest): Promise<boolean>;
  revokeFamily(familyId: string, now: Date): Promise<void>;
  revokeAllOfUser(userId: string, now: Date): Promise<void>;
}

export const SESSION_REPOSITORY = Symbol('SESSION_REPOSITORY');
