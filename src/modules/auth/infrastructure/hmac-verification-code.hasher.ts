import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type Environment } from '../../../shared/config/environment.schema';
import { type VerificationCodeHasher } from '../application/ports/verification-code.hasher';

const HEX_DIGEST_LENGTH = 64;

/**
 * HMAC-SHA-256 con un secreto del servidor (el "pepper"). Un hash simple de 6 dígitos se revertiría
 * en un instante probando el millón de códigos; con el pepper, quien robe solo la base de datos no puede.
 */
@Injectable()
export class HmacVerificationCodeHasher implements VerificationCodeHasher {
  private readonly pepper: Buffer;

  constructor(configService: ConfigService<Environment, true>) {
    const pepperBase64: string = configService.get('AUTH_CODE_PEPPER_BASE64', { infer: true });
    this.pepper = Buffer.from(pepperBase64, 'base64');
  }

  hash(code: string): string {
    return createHmac('sha256', this.pepper).update(code).digest('hex');
  }

  matches(code: string, storedHash: string): boolean {
    if (storedHash.length !== HEX_DIGEST_LENGTH) return false;

    const expected = Buffer.from(this.hash(code), 'hex');
    const actual = Buffer.from(storedHash, 'hex');
    // `Buffer.from(..., 'hex')` descarta caracteres no hexadecimales: se vuelve a comprobar el tamaño.
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }
}
