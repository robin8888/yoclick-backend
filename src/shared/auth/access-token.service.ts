import { Injectable, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SignJWT, decodeProtectedHeader, importPKCS8, importSPKI, jwtVerify } from 'jose';
import { v7 as generateUuidV7 } from 'uuid';
import { z } from 'zod';
import { type Environment } from '../config/environment.schema';
import { DomainError } from '../errors/domain-error';
import { HTTP_STATUS } from '../errors/http-status';
import { MILLISECONDS_PER_SECOND } from '../time/time-units';

const TOKEN_ISSUER = 'https://api.yoclick.app';
const TOKEN_AUDIENCE = 'yoclick-app';
const SIGNING_ALGORITHM = 'EdDSA';
/** SEC-44: token de acceso de vida corta; la sesión larga la sostiene el refresh token rotativo. */
const ACCESS_TOKEN_LIFETIME_SECONDS = 600;
const CLOCK_TOLERANCE_SECONDS = 5;

const subjectSchema = z.uuid();

type PrivateSigningKey = Awaited<ReturnType<typeof importPKCS8>>;
type PublicVerificationKey = Awaited<ReturnType<typeof importSPKI>>;

interface KeyPair {
  readonly privateKey: PrivateSigningKey;
  readonly publicKey: PublicVerificationKey;
}

export interface IssuedAccessToken {
  readonly token: string;
  readonly expiresAt: Date;
}

export interface AccessTokenClaims {
  readonly userId: string;
  readonly tokenId: string;
}

/**
 * Emite y verifica los tokens de acceso (JWT firmado con EdDSA, SEC-44).
 *
 * Al verificar solo se acepta EdDSA con la clave configurada, lo que descarta `alg: none` y la
 * confusión de algoritmos (HS256 firmado con la clave pública). Cualquier fallo se responde con el
 * mismo 401: no se dice si caducó, si la firma era mala o si la audiencia no era la nuestra.
 */
@Injectable()
export class AccessTokenService implements OnModuleInit {
  private readonly keyId: string;
  private loadedKeyPair: Promise<KeyPair> | undefined;

  constructor(private readonly configService: ConfigService<Environment, true>) {
    this.keyId = configService.get('JWT_KEY_ID', { infer: true });
  }

  /** Falla al arrancar, no en la primera petición, si las claves configuradas no son válidas. */
  async onModuleInit(): Promise<void> {
    await this.getKeyPair();
  }

  async issue(userId: string): Promise<IssuedAccessToken> {
    const { privateKey } = await this.getKeyPair();
    const issuedAtSeconds = Math.floor(Date.now() / MILLISECONDS_PER_SECOND);
    const expiresAtSeconds = issuedAtSeconds + ACCESS_TOKEN_LIFETIME_SECONDS;

    const token = await new SignJWT({})
      .setProtectedHeader({ alg: SIGNING_ALGORITHM, kid: this.keyId, typ: 'JWT' })
      .setIssuer(TOKEN_ISSUER)
      .setAudience(TOKEN_AUDIENCE)
      .setSubject(userId)
      .setJti(generateUuidV7())
      .setIssuedAt(issuedAtSeconds)
      .setExpirationTime(expiresAtSeconds)
      .sign(privateKey);

    return { token, expiresAt: new Date(expiresAtSeconds * MILLISECONDS_PER_SECOND) };
  }

  async verify(token: string): Promise<AccessTokenClaims> {
    try {
      return await this.verifyOrThrow(token);
    } catch {
      throw new DomainError('UNAUTHENTICATED', HTTP_STATUS.unauthorized);
    }
  }

  private async verifyOrThrow(token: string): Promise<AccessTokenClaims> {
    const { publicKey } = await this.getKeyPair();
    if (decodeProtectedHeader(token).kid !== this.keyId) throw new Error('unknown key id');

    const { payload } = await jwtVerify(token, publicKey, {
      algorithms: [SIGNING_ALGORITHM],
      issuer: TOKEN_ISSUER,
      audience: TOKEN_AUDIENCE,
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
      requiredClaims: ['sub', 'jti', 'exp', 'iat'],
    });

    return {
      userId: subjectSchema.parse(payload.sub),
      tokenId: z.string().min(1).parse(payload.jti),
    };
  }

  private getKeyPair(): Promise<KeyPair> {
    this.loadedKeyPair ??= this.importKeyPair();
    return this.loadedKeyPair;
  }

  private async importKeyPair(): Promise<KeyPair> {
    const decodePem = (
      variableName: 'JWT_ACCESS_PRIVATE_KEY_BASE64' | 'JWT_ACCESS_PUBLIC_KEY_BASE64',
    ) =>
      Buffer.from(this.configService.get(variableName, { infer: true }), 'base64').toString('utf8');

    return {
      privateKey: await importPKCS8(decodePem('JWT_ACCESS_PRIVATE_KEY_BASE64'), SIGNING_ALGORITHM),
      publicKey: await importSPKI(decodePem('JWT_ACCESS_PUBLIC_KEY_BASE64'), SIGNING_ALGORITHM),
    };
  }
}
