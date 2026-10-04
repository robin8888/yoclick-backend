import { Injectable } from '@nestjs/common';
import { argon2id, hash as hashWithArgon2, needsRehash, verify as verifyWithArgon2 } from 'argon2';

/** SEC-43: argon2id con al menos m = 19 MiB, t = 2, p = 1 (recomendación OWASP). */
const ARGON2_OPTIONS = { type: argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

/**
 * Hash de contraseñas. Es el único sitio donde se tocan contraseñas en claro: se cifran aquí y no se
 * guardan ni se registran en ningún otro punto.
 */
@Injectable()
export class PasswordHasher {
  async hash(plainPassword: string): Promise<string> {
    return hashWithArgon2(plainPassword, ARGON2_OPTIONS);
  }

  /** Un hash corrupto o vacío es un "no coincide", no una excepción que delate el fallo. */
  async verify(storedHash: string, plainPassword: string): Promise<boolean> {
    try {
      return await verifyWithArgon2(storedHash, plainPassword);
    } catch {
      return false;
    }
  }

  /** `true` si el hash se hizo con parámetros más débiles que los actuales: se recalcula al iniciar sesión. */
  needsRehash(storedHash: string): boolean {
    return needsRehash(storedHash, ARGON2_OPTIONS);
  }

  /**
   * Para el login con un email que no existe: gasta lo mismo que una verificación real, de modo que
   * el tiempo de respuesta no permita saber qué emails están registrados (SEC-46).
   */
  async spendTimeLikeAVerification(plainPassword: string): Promise<void> {
    await this.hash(plainPassword);
  }
}
