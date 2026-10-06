import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '../../../shared/errors/domain-error';
import { HTTP_STATUS } from '../../../shared/errors/http-status';
import { type JoinDecision, type JoinSource } from '../domain/join-decision';
import { normalizeJoinCode } from '../domain/join-code';
import { JOIN_REPOSITORY, type JoinOutcome, type JoinRepository } from './ports/join.repository';

export interface JoinCenterRequest {
  readonly userId: string;
  readonly centerId: string;
  readonly joinCode: string | undefined;
  readonly source: JoinSource | undefined;
}

export interface JoinedCenter {
  readonly membershipId: string;
  readonly centerId: string;
  readonly role: string;
  readonly status: string;
  readonly isNewMembership: boolean;
}

const REFUSALS: Partial<
  Record<
    JoinDecision,
    {
      code: 'JOIN_CODE_INVALID' | 'MEMBERSHIP_BLOCKED' | 'CLIENT_LIMIT_REACHED';
      httpStatus: number;
    }
  >
> = {
  center_not_joinable: { code: 'JOIN_CODE_INVALID', httpStatus: HTTP_STATUS.notFound },
  membership_blocked: { code: 'MEMBERSHIP_BLOCKED', httpStatus: HTTP_STATUS.forbidden },
  client_limit_reached: { code: 'CLIENT_LIMIT_REACHED', httpStatus: HTTP_STATUS.conflict },
};

/**
 * Unirse como cliente. Un centro inexistente, uno privado sin su código y uno suspendido responden
 * igual (`JOIN_CODE_INVALID`): el id de un centro no basta para entrar ni para confirmar que existe.
 */
@Injectable()
export class JoinCenterUseCase {
  constructor(@Inject(JOIN_REPOSITORY) private readonly joins: JoinRepository) {}

  async execute(request: JoinCenterRequest): Promise<JoinedCenter> {
    const presentedJoinCode =
      request.joinCode === undefined ? null : normalizeJoinCode(request.joinCode);
    const outcome = await this.joins.joinAsClient({
      userId: request.userId,
      centerId: request.centerId,
      presentedJoinCode,
      source: request.source ?? null,
    });

    const refusal = REFUSALS[outcome.decision];
    if (refusal) throw new DomainError(refusal.code, refusal.httpStatus);
    return toJoinedCenter(outcome);
  }
}

function toJoinedCenter({ decision, membership }: JoinOutcome): JoinedCenter {
  if (!membership) throw new Error(`Decision ${decision} left no membership`);
  return {
    membershipId: membership.id,
    centerId: membership.centerId,
    role: membership.role,
    status: membership.status,
    isNewMembership: decision !== 'already_member',
  };
}
