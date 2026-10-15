import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '../../../shared/errors/domain-error';
import { HTTP_STATUS } from '../../../shared/errors/http-status';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import {
  GUARDIAN_REPOSITORY,
  type ChildView,
  type GuardianRepository,
  type GuardianView,
} from './ports/guardian.repository';

@Injectable()
export class ListGuardiansUseCase {
  constructor(@Inject(GUARDIAN_REPOSITORY) private readonly guardians: GuardianRepository) {}

  async execute(actor: ActorContext, childMembershipId: string): Promise<GuardianView[]> {
    const guardians = await this.guardians.listGuardiansOf(actor, childMembershipId);
    if (guardians === null) throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
    return guardians;
  }
}

@Injectable()
export class LinkGuardianUseCase {
  constructor(@Inject(GUARDIAN_REPOSITORY) private readonly guardians: GuardianRepository) {}

  /** El centro enlaza a un tutor con su hijo: así comprueba que lo es. */
  async execute(
    actor: ActorContext,
    request: { guardianMembershipId: string; childMembershipId: string },
  ): Promise<void> {
    const outcome = await this.guardians.linkGuardian(actor, { ...request, now: new Date() });
    if (outcome.kind === 'linked') return;
    if (outcome.kind === 'not_found') throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
    if (outcome.kind === 'already_linked') {
      throw new DomainError('GUARDIAN_ALREADY_LINKED', HTTP_STATUS.conflict);
    }
    if (outcome.kind === 'guardian_is_minor') {
      throw new DomainError('GUARDIAN_MUST_BE_ADULT', HTTP_STATUS.conflict);
    }
    throw new DomainError('GUARDIAN_INVALID_PEOPLE', HTTP_STATUS.conflict);
  }
}

@Injectable()
export class UnlinkGuardianUseCase {
  constructor(@Inject(GUARDIAN_REPOSITORY) private readonly guardians: GuardianRepository) {}

  async execute(
    actor: ActorContext,
    request: { guardianMembershipId: string; childMembershipId: string },
  ): Promise<void> {
    const wasLinked = await this.guardians.unlinkGuardian(actor, request);
    if (!wasLinked) throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
  }
}

@Injectable()
export class ListMyChildrenUseCase {
  constructor(@Inject(GUARDIAN_REPOSITORY) private readonly guardians: GuardianRepository) {}

  execute(actor: ActorContext): Promise<ChildView[]> {
    return this.guardians.listMyChildren(actor, new Date());
  }
}
