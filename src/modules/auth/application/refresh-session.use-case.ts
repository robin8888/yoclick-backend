import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '../../../shared/errors/domain-error';
import { HTTP_STATUS } from '../../../shared/errors/http-status';
import { hashRefreshToken } from '../domain/refresh-token';
import { SESSION_REPOSITORY, type SessionRepository } from './ports/session.repository';
import { SessionIssuer, type SessionTokens } from './session-issuer';

export interface RefreshSessionCommand {
  readonly refreshToken: string;
  readonly deviceName: string | null;
}

function sessionInvalidError(): DomainError {
  return new DomainError('SESSION_INVALID', HTTP_STATUS.unauthorized);
}

/**
 * Renueva la sesión rotando el refresh token. Cada token vale UNA vez: usar uno ya rotado solo
 * puede significar que alguien lo copió, así que se revoca toda la familia (SEC-45) y la persona
 * tiene que iniciar sesión de nuevo en ese dispositivo. Todos los fallos responden igual.
 */
@Injectable()
export class RefreshSessionUseCase {
  constructor(
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepository,
    private readonly sessionIssuer: SessionIssuer,
  ) {}

  async execute(command: RefreshSessionCommand): Promise<SessionTokens> {
    const now = new Date();
    const stored = await this.sessions.findByTokenHash(hashRefreshToken(command.refreshToken));
    if (!stored) throw sessionInvalidError();

    if (stored.revokedAt !== null) {
      await this.sessions.revokeFamily(stored.familyId, now);
      throw sessionInvalidError();
    }
    if (stored.expiresAt <= now) throw sessionInvalidError();

    const rotated = await this.sessionIssuer.rotateSession({
      current: stored,
      deviceName: command.deviceName,
      now,
    });
    if (rotated === null) {
      // Otra petición con el mismo token ganó la carrera: es reutilización, no un reintento legítimo.
      await this.sessions.revokeFamily(stored.familyId, now);
      throw sessionInvalidError();
    }
    return rotated;
  }
}
