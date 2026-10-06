import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '../../../shared/errors/domain-error';
import { HTTP_STATUS } from '../../../shared/errors/http-status';
import { hashRefreshToken } from '../domain/refresh-token';
import { SESSION_REPOSITORY, type SessionRepository } from './ports/session.repository';

export interface OpenSession {
  readonly id: string;
  readonly deviceName: string | null;
  readonly startedAt: Date;
  readonly lastActiveAt: Date;
  /** La sesión desde la que se pregunta. */
  readonly isCurrent: boolean;
}

export interface ListOpenSessionsCommand {
  readonly userId: string;
  /** El refresh token de este dispositivo: así se sabe cuál es esta sesión. */
  readonly currentRefreshToken: string;
}

/** Los dispositivos con sesión abierta de una persona, la más reciente primero. */
@Injectable()
export class ListOpenSessionsUseCase {
  constructor(@Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepository) {}

  async execute(command: ListOpenSessionsCommand): Promise<OpenSession[]> {
    const now = new Date();
    const stored = await this.sessions.findByTokenHash(
      hashRefreshToken(command.currentRefreshToken),
    );
    const currentFamilyId = stored?.userId === command.userId ? stored.familyId : null;
    const records = await this.sessions.listActiveOfUser(command.userId, now);
    return records
      .map((record) => ({
        id: record.familyId,
        deviceName: record.deviceName,
        startedAt: record.startedAt,
        lastActiveAt: record.lastActiveAt,
        isCurrent: record.familyId === currentFamilyId,
      }))
      .sort((first, second) => second.lastActiveAt.getTime() - first.lastActiveAt.getTime());
  }
}

/** Cierra la sesión de otro dispositivo propio. Una sesión ajena o inexistente es un 404. */
@Injectable()
export class RevokeOpenSessionUseCase {
  constructor(@Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepository) {}

  async execute(userId: string, sessionId: string): Promise<void> {
    const wasRevoked = await this.sessions.revokeFamilyOfUser(userId, sessionId, new Date());
    if (!wasRevoked) throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
  }
}
