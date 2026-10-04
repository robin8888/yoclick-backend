import { createHash, randomBytes } from 'node:crypto';

const REFRESH_TOKEN_BYTES = 32;

export interface GeneratedRefreshToken {
  /** Lo que recibe el dispositivo. Nunca se guarda. */
  readonly token: string;
  /** Lo único que se guarda: si se filtra la base de datos, no sirve para iniciar sesión. */
  readonly tokenHash: string;
}

/**
 * SHA-256 sin sal: el token ya tiene 256 bits aleatorios, así que no hay nada que adivinar ni que
 * precalcular, y un hash determinista permite buscarlo directamente en la base de datos.
 */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Token opaco aleatorio (no un JWT): se puede revocar al instante y no lleva datos que descifrar. */
export function generateRefreshToken(): GeneratedRefreshToken {
  const token = randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
  return { token, tokenHash: hashRefreshToken(token) };
}
