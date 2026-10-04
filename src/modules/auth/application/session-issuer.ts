import { Inject, Injectable } from '@nestjs/common';
import { v7 as generateUuidV7 } from 'uuid';
import {
  AccessTokenService,
  type IssuedAccessToken,
} from '../../../shared/auth/access-token.service';
import { MILLISECONDS_PER_HOUR } from '../../../shared/time/time-units';
import { REFRESH_TOKEN_TTL_DAYS } from '../domain/login-policy';
import { generateRefreshToken } from '../domain/refresh-token';
import {
  SESSION_REPOSITORY,
  type NewRefreshToken,
  type SessionRepository,
  type StoredRefreshToken,
} from './ports/session.repository';

const HOURS_PER_DAY = 24;
const REFRESH_TOKEN_TTL_MS = REFRESH_TOKEN_TTL_DAYS * HOURS_PER_DAY * MILLISECONDS_PER_HOUR;

export interface SessionTokens {
  readonly accessToken: string;
  readonly accessTokenExpiresAt: Date;
  readonly refreshToken: string;
  readonly refreshTokenExpiresAt: Date;
}

interface StartSessionInput {
  readonly userId: string;
  readonly deviceName: string | null;
  /** La persona acaba de demostrar un segundo factor: las rutas de administración lo exigen. */
  readonly isMfaVerified: boolean;
}

interface RotateSessionInput {
  readonly current: StoredRefreshToken;
  readonly deviceName: string | null;
  readonly now: Date;
}

/** Crea y rota las sesiones: un access token corto más un refresh token largo, opaco y rotativo. */
@Injectable()
export class SessionIssuer {
  constructor(
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepository,
    private readonly accessTokenService: AccessTokenService,
  ) {}

  /** Un inicio de sesión abre una familia nueva: cada dispositivo se revoca por separado. */
  async startSession(input: StartSessionInput): Promise<SessionTokens> {
    const refresh = generateRefreshToken();
    const newToken = this.buildToken({
      userId: input.userId,
      familyId: generateUuidV7(),
      tokenHash: refresh.tokenHash,
      deviceName: input.deviceName,
      isMfaVerified: input.isMfaVerified,
    });
    await this.sessions.create(newToken);
    return this.buildTokens(input.userId, refresh.token, newToken);
  }

  /**
   * `null` si otra petición rotó este mismo token antes: el llamante lo trata como reutilización.
   * El nivel de autenticación de la sesión se hereda: renovar no sube ni baja de segundo factor.
   */
  async rotateSession(input: RotateSessionInput): Promise<SessionTokens | null> {
    const refresh = generateRefreshToken();
    const newToken = this.buildToken({
      userId: input.current.userId,
      familyId: input.current.familyId,
      tokenHash: refresh.tokenHash,
      deviceName: input.deviceName,
      isMfaVerified: input.current.isMfaVerified,
    });
    const wasRotated = await this.sessions.rotate({
      currentTokenId: input.current.id,
      newToken,
      now: input.now,
    });
    if (!wasRotated) return null;
    return this.buildTokens(input.current.userId, refresh.token, newToken);
  }

  /** Lo que recibe la app tras acertar la contraseña de una cuenta con segundo factor. */
  async issueMfaChallenge(userId: string): Promise<IssuedAccessToken> {
    return this.accessTokenService.issueMfaChallenge(userId);
  }

  async verifyMfaChallenge(challengeToken: string): Promise<{ readonly userId: string }> {
    return this.accessTokenService.verifyMfaChallenge(challengeToken);
  }

  private buildToken(
    fields: Pick<
      NewRefreshToken,
      'userId' | 'familyId' | 'tokenHash' | 'deviceName' | 'isMfaVerified'
    >,
  ): NewRefreshToken {
    return {
      id: generateUuidV7(),
      ...fields,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    };
  }

  private async buildTokens(
    userId: string,
    refreshToken: string,
    stored: NewRefreshToken,
  ): Promise<SessionTokens> {
    const accessToken = await this.accessTokenService.issue(userId, {
      isMfaVerified: stored.isMfaVerified,
    });
    return {
      accessToken: accessToken.token,
      accessTokenExpiresAt: accessToken.expiresAt,
      refreshToken,
      refreshTokenExpiresAt: stored.expiresAt,
    };
  }
}
