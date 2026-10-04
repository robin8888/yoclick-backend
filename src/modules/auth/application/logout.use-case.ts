import { Inject, Injectable } from '@nestjs/common';
import { hashRefreshToken } from '../domain/refresh-token';
import { SESSION_REPOSITORY, type SessionRepository } from './ports/session.repository';

export interface LogoutCommand {
  readonly userId: string;
  readonly refreshToken: string | null;
  /** Cierra la sesión en todos los dispositivos. */
  readonly everywhere: boolean;
}

/**
 * Cierra sesión. Siempre responde igual (éxito): ni un token desconocido ni uno ajeno producen un error
 * que sirva para sondear tokens, y nunca se puede revocar la sesión de otra persona.
 */
@Injectable()
export class LogoutUseCase {
  constructor(@Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepository) {}

  async execute(command: LogoutCommand): Promise<void> {
    const now = new Date();
    if (command.everywhere) {
      await this.sessions.revokeAllOfUser(command.userId, now);
      return;
    }
    if (command.refreshToken === null) return;

    const stored = await this.sessions.findByTokenHash(hashRefreshToken(command.refreshToken));
    if (stored?.userId === command.userId) {
      await this.sessions.revokeFamily(stored.familyId, now);
    }
  }
}
