import { createHmac } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type Environment } from '../../../shared/config/environment.schema';

const CLIENT_ADDRESS_CONTEXT = 'client-address:';

/**
 * Hash del IP de quien se registra, como evidencia del consentimiento (RGPD) sin guardar el IP.
 * HMAC con el pepper y un prefijo de contexto, de modo que ni se pueda revertir probando las
 * direcciones IPv4 ni coincida con ningún otro hash del sistema.
 */
@Injectable()
export class ClientAddressHasher {
  private readonly pepper: Buffer;

  constructor(configService: ConfigService<Environment, true>) {
    const pepperBase64: string = configService.get('AUTH_CODE_PEPPER_BASE64', { infer: true });
    this.pepper = Buffer.from(pepperBase64, 'base64');
  }

  hash(clientAddress: string): string {
    return createHmac('sha256', this.pepper)
      .update(`${CLIENT_ADDRESS_CONTEXT}${clientAddress}`)
      .digest('hex');
  }
}
