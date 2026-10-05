import { Injectable, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  SignJWT,
  decodeProtectedHeader,
  importPKCS8,
  importSPKI,
  jwtVerify,
  type JWTPayload,
} from 'jose';
import { v7 as generateUuidV7 } from 'uuid';
import { z } from 'zod';
import { type Environment } from '../config/environment.schema';
import { DomainError } from '../errors/domain-error';
import { HTTP_STATUS } from '../errors/http-status';
import { MILLISECONDS_PER_SECOND } from '../time/time-units';

const TOKEN_ISSUER = 'https://api.yoclick.app';
const ACCESS_TOKEN_AUDIENCE = 'yoclick-app';
/** Otra audiencia: un token de desafío jamás es válido como token de acceso, ni al revés. */
const MFA_CHALLENGE_AUDIENCE = 'yoclick-mfa-challenge';
/** Un token de asistencia solo vale para registrar asistencia: ni como acceso ni como desafío. */
const CHECKIN_AUDIENCE = 'yoclick-checkin';
const SIGNING_ALGORITHM = 'EdDSA';
/** SEC-44: token de acceso de vida corta; la sesión larga la sostiene el refresh token rotativo. */
const ACCESS_TOKEN_LIFETIME_SECONDS = 600;
/** Tiempo para teclear el código del segundo factor tras haber acertado la contraseña. */
const MFA_CHALLENGE_LIFETIME_SECONDS = 300;
/** El QR de asistencia se enseña en pantalla y se escanea al momento: vida corta, la app lo renueva. */
export const CHECKIN_TOKEN_LIFETIME_SECONDS = 300;
const CLOCK_TOLERANCE_SECONDS = 5;
/** Métodos de autenticación (claim `amr`, RFC 8176): contraseña, y contraseña más código de un solo uso. */
const PASSWORD_METHOD = 'pwd';
const ONE_TIME_CODE_METHOD = 'otp';

const subjectSchema = z.uuid();
const authenticationMethodsSchema = z.array(z.string()).optional();

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

export interface CheckinTokenClaims {
  readonly membershipId: string;
  readonly centerId: string;
}

export interface AccessTokenClaims {
  readonly userId: string;
  readonly tokenId: string;
  /** La sesión se abrió con segundo factor. Las rutas de administración lo exigen. */
  readonly isMfaVerified: boolean;
}

interface IssueAccessTokenOptions {
  readonly isMfaVerified: boolean;
}

interface SigningRequest {
  readonly userId: string;
  readonly audience: string;
  readonly lifetimeSeconds: number;
  readonly claims: JWTPayload;
}

/**
 * Emite y verifica los tokens de acceso y los de desafío de segundo factor (JWT firmados con EdDSA, SEC-44).
 *
 * Al verificar solo se acepta EdDSA con la clave configurada, lo que descarta `alg: none` y la confusión
 * de algoritmos (HS256 firmado con la clave pública). Cualquier fallo se responde con el mismo 401: no se
 * dice si caducó, si la firma era mala o si la audiencia no era la nuestra.
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

  async issue(
    userId: string,
    options: IssueAccessTokenOptions = { isMfaVerified: false },
  ): Promise<IssuedAccessToken> {
    const methods = options.isMfaVerified
      ? [PASSWORD_METHOD, ONE_TIME_CODE_METHOD]
      : [PASSWORD_METHOD];
    return this.sign({
      userId,
      audience: ACCESS_TOKEN_AUDIENCE,
      lifetimeSeconds: ACCESS_TOKEN_LIFETIME_SECONDS,
      claims: { amr: methods },
    });
  }

  async verify(token: string): Promise<AccessTokenClaims> {
    try {
      const payload = await this.verifyOrThrow(token, ACCESS_TOKEN_AUDIENCE);
      const methods = authenticationMethodsSchema.parse(payload['amr']);
      return {
        userId: subjectSchema.parse(payload.sub),
        tokenId: z.string().min(1).parse(payload.jti),
        isMfaVerified: methods?.includes(ONE_TIME_CODE_METHOD) ?? false,
      };
    } catch {
      throw new DomainError('UNAUTHENTICATED', HTTP_STATUS.unauthorized);
    }
  }

  /** Lo que recibe la app tras acertar la contraseña de una cuenta con segundo factor, a cambio del código. */
  async issueMfaChallenge(userId: string): Promise<IssuedAccessToken> {
    return this.sign({
      userId,
      audience: MFA_CHALLENGE_AUDIENCE,
      lifetimeSeconds: MFA_CHALLENGE_LIFETIME_SECONDS,
      claims: {},
    });
  }

  async verifyMfaChallenge(token: string): Promise<{ readonly userId: string }> {
    try {
      const payload = await this.verifyOrThrow(token, MFA_CHALLENGE_AUDIENCE);
      return { userId: subjectSchema.parse(payload.sub) };
    } catch {
      throw new DomainError('SESSION_INVALID', HTTP_STATUS.unauthorized);
    }
  }

  /** El QR de asistencia de una persona clienta: lo firma el servidor, la app solo lo enseña. */
  async issueCheckinToken(claims: CheckinTokenClaims): Promise<IssuedAccessToken> {
    return this.sign({
      userId: claims.membershipId,
      audience: CHECKIN_AUDIENCE,
      lifetimeSeconds: CHECKIN_TOKEN_LIFETIME_SECONDS,
      claims: { cid: claims.centerId },
    });
  }

  async verifyCheckinToken(token: string): Promise<CheckinTokenClaims> {
    try {
      const payload = await this.verifyOrThrow(token, CHECKIN_AUDIENCE);
      return {
        membershipId: subjectSchema.parse(payload.sub),
        centerId: subjectSchema.parse(payload['cid']),
      };
    } catch {
      throw new DomainError('CHECKIN_CODE_INVALID', HTTP_STATUS.unprocessableEntity);
    }
  }

  private async sign(request: SigningRequest): Promise<IssuedAccessToken> {
    const { privateKey } = await this.getKeyPair();
    const issuedAtSeconds = Math.floor(Date.now() / MILLISECONDS_PER_SECOND);
    const expiresAtSeconds = issuedAtSeconds + request.lifetimeSeconds;

    const token = await new SignJWT(request.claims)
      .setProtectedHeader({ alg: SIGNING_ALGORITHM, kid: this.keyId, typ: 'JWT' })
      .setIssuer(TOKEN_ISSUER)
      .setAudience(request.audience)
      .setSubject(request.userId)
      .setJti(generateUuidV7())
      .setIssuedAt(issuedAtSeconds)
      .setExpirationTime(expiresAtSeconds)
      .sign(privateKey);

    return { token, expiresAt: new Date(expiresAtSeconds * MILLISECONDS_PER_SECOND) };
  }

  private async verifyOrThrow(token: string, audience: string): Promise<JWTPayload> {
    const { publicKey } = await this.getKeyPair();
    if (decodeProtectedHeader(token).kid !== this.keyId) throw new Error('unknown key id');

    const { payload } = await jwtVerify(token, publicKey, {
      algorithms: [SIGNING_ALGORITHM],
      issuer: TOKEN_ISSUER,
      audience,
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
      requiredClaims: ['sub', 'jti', 'exp', 'iat'],
    });
    return payload;
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
