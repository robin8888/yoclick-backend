export interface NewRefreshToken {
  readonly id: string;
  readonly userId: string;
  /** Todos los tokens descendientes de un mismo inicio de sesión comparten familia. */
  readonly familyId: string;
  readonly tokenHash: string;
  readonly deviceName: string | null;
  /** La sesión se abrió con segundo factor; se conserva en toda la familia al rotar. */
  readonly isMfaVerified: boolean;
  readonly expiresAt: Date;
}

export interface StoredRefreshToken {
  readonly id: string;
  readonly userId: string;
  readonly familyId: string;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  readonly isMfaVerified: boolean;
  /** El dispositivo con el que se inició sesión; se conserva al renovar. */
  readonly deviceName: string | null;
}

export interface RotationRequest {
  readonly currentTokenId: string;
  readonly newToken: NewRefreshToken;
  readonly now: Date;
}

/** Un inicio de sesión que sigue abierto en algún dispositivo de la persona. */
export interface ActiveSessionRecord {
  readonly familyId: string;
  readonly deviceName: string | null;
  /** Cuándo se inició sesión en ese dispositivo. */
  readonly startedAt: Date;
  /** La última vez que el dispositivo renovó su sesión. */
  readonly lastActiveAt: Date;
}

export interface SessionRepository {
  listActiveOfUser(userId: string, now: Date): Promise<ActiveSessionRecord[]>;
  /** Cierra la sesión de un dispositivo, solo si es de esa persona. `false` si no existe o es ajena. */
  revokeFamilyOfUser(userId: string, familyId: string, now: Date): Promise<boolean>;
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
