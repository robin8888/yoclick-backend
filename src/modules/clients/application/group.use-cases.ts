import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '../../../shared/errors/domain-error';
import { HTTP_STATUS } from '../../../shared/errors/http-status';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import {
  GROUP_REPOSITORY,
  type GroupRepository,
  type GroupView,
  type NewGroup,
} from './ports/group.repository';

@Injectable()
export class ListGroupsUseCase {
  constructor(@Inject(GROUP_REPOSITORY) private readonly groups: GroupRepository) {}

  async execute(actor: ActorContext): Promise<GroupView[]> {
    return this.groups.listGroups(actor);
  }
}

@Injectable()
export class CreateGroupUseCase {
  constructor(@Inject(GROUP_REPOSITORY) private readonly groups: GroupRepository) {}

  async execute(actor: ActorContext, newGroup: NewGroup): Promise<GroupView> {
    const outcome = await this.groups.createGroup(actor, newGroup);
    if (outcome.kind === 'created') return outcome.group;
    if (outcome.kind === 'duplicate_name') {
      throw new DomainError('CONFLICT', HTTP_STATUS.conflict, [
        { path: 'name', code: 'group_name_taken' },
      ]);
    }
    const invalidField =
      outcome.kind === 'unknown_instructor'
        ? { path: 'instructorMembershipId', code: 'unknown_instructor' }
        : { path: 'name', code: 'too_many_groups' };
    throw new DomainError('VALIDATION_FAILED', HTTP_STATUS.badRequest, [invalidField]);
  }
}

/** Archivar conserva el rastro; los clientes del grupo quedan sin grupo. */
@Injectable()
export class ArchiveGroupUseCase {
  constructor(@Inject(GROUP_REPOSITORY) private readonly groups: GroupRepository) {}

  async execute(actor: ActorContext, groupId: string): Promise<void> {
    const wasArchived = await this.groups.archiveGroup(actor, groupId);
    if (!wasArchived) throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
  }
}
