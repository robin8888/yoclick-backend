import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { type BreachedPasswordChecker } from '../application/ports/breached-password.checker';

const PWNED_RANGE_URL = 'https://api.pwnedpasswords.com/range';
const HASH_PREFIX_LENGTH = 5;
const REQUEST_TIMEOUT_MS = 3_000;

/**
 * Comprobación con Have I Been Pwned por k-anonymity: solo se envían los 5 primeros caracteres del
 * SHA-1; la contraseña y el hash completo no salen del servidor, y la comparación se hace aquí.
 *
 * Si el servicio no responde, se deja pasar (fail open) y se avisa en el log: el registro no puede
 * depender de un tercero. Es una defensa adicional a la longitud mínima, no la única.
 */
@Injectable()
export class PwnedPasswordsChecker implements BreachedPasswordChecker {
  constructor(private readonly logger: PinoLogger) {}

  async isBreached(plainPassword: string): Promise<boolean> {
    // SHA-1 lo exige el protocolo de Have I Been Pwned; no se usa para proteger nada nuestro.
    // eslint-disable-next-line sonarjs/hashing
    const sha1 = createHash('sha1').update(plainPassword).digest('hex').toUpperCase();
    const prefix = sha1.slice(0, HASH_PREFIX_LENGTH);
    const suffix = sha1.slice(HASH_PREFIX_LENGTH);

    const rangeListing = await this.fetchRange(prefix);
    return rangeListing !== null && this.containsBreachedSuffix(rangeListing, suffix);
  }

  private async fetchRange(prefix: string): Promise<string | null> {
    try {
      const response = await fetch(`${PWNED_RANGE_URL}/${prefix}`, {
        headers: { 'add-padding': 'true' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`status ${String(response.status)}`);
      return await response.text();
    } catch (error) {
      // Solo el motivo genérico: nunca el hash ni la contraseña.
      this.logger.warn(
        { reason: error instanceof Error ? error.name : 'unknown' },
        'Breached-password check unavailable; allowing the password',
      );
      return null;
    }
  }

  private containsBreachedSuffix(rangeListing: string, suffix: string): boolean {
    return rangeListing.split('\n').some((line) => {
      const [lineSuffix, count] = line.trim().split(':');
      // Las líneas con recuento 0 son relleno (Add-Padding), no filtraciones reales.
      return lineSuffix === suffix && Number(count) > 0;
    });
  }
}
