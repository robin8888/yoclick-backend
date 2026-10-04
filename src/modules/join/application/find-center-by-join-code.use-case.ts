import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '../../../shared/errors/domain-error';
import { HTTP_STATUS } from '../../../shared/errors/http-status';
import { normalizeJoinCode } from '../domain/join-code';
import {
  JOIN_REPOSITORY,
  type JoinRepository,
  type PublicCenterSummary,
} from './ports/join.repository';

/** Un código mal formado y uno que no existe responden igual: no se enseña qué códigos hay. */
@Injectable()
export class FindCenterByJoinCodeUseCase {
  constructor(@Inject(JOIN_REPOSITORY) private readonly joins: JoinRepository) {}

  async execute(rawJoinCode: string): Promise<PublicCenterSummary> {
    const joinCode = normalizeJoinCode(rawJoinCode);
    const center = joinCode ? await this.joins.findCenterByJoinCode(joinCode) : null;
    if (!center) throw new DomainError('JOIN_CODE_INVALID', HTTP_STATUS.notFound);
    return center;
  }
}
