import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type Environment } from '../config/environment.schema';

const ALGORITHM = 'aes-256-gcm';
const FORMAT_VERSION = 'v1';
const IV_BYTES = 12;
const AUTHENTICATION_TAG_BYTES = 16;
const EXPECTED_PARTS = 4;

/**
 * Cifra secretos que deben poder recuperarse (el secreto TOTP, que hay que leer para validar códigos),
 * con AES-256-GCM de Node: cifrado autenticado, IV aleatorio nuevo en cada operación y formato versionado
 * (`v1.iv.tag.cifrado`) para poder rotar la clave o el algoritmo sin romper lo guardado.
 *
 * La clave llega por entorno. En producción debe venir de un KMS con cifrado de sobre (SEC-70); la
 * interfaz no cambia cuando se haga.
 */
@Injectable()
export class SecretEncryptor {
  private readonly key: Buffer;

  constructor(configService: ConfigService<Environment, true>) {
    const keyBase64: string = configService.get('MFA_ENCRYPTION_KEY_BASE64', { infer: true });
    this.key = Buffer.from(keyBase64, 'base64');
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return [FORMAT_VERSION, ...[iv, cipher.getAuthTag(), ciphertext].map(toBase64Url)].join('.');
  }

  decrypt(encrypted: string): string {
    const parts = encrypted.split('.');
    const [version, iv, authenticationTag, ciphertext] = parts;
    if (
      parts.length !== EXPECTED_PARTS ||
      version !== FORMAT_VERSION ||
      iv === undefined ||
      authenticationTag === undefined ||
      ciphertext === undefined
    ) {
      throw new Error('Unsupported encrypted value format');
    }

    const tag = Buffer.from(authenticationTag, 'base64url');
    if (tag.length !== AUTHENTICATION_TAG_BYTES) throw new Error('Invalid authentication tag');

    const decipher = createDecipheriv(ALGORITHM, this.key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }
}

function toBase64Url(value: Buffer): string {
  return value.toString('base64url');
}
