import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '../../../shared/errors/domain-error';
import { HTTP_STATUS } from '../../../shared/errors/http-status';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { decideTeamChange } from '../domain/team-rules';
import {
  TEAM_REPOSITORY,
  type TeamMember,
  type TeamMemberUpdate,
  type TeamRepository,
} from './ports/team.repository';
import { ActivityRecorder } from '../../activity/application/activity-recorder';

@Injectable()
export class ListTeamUseCase {
  constructor(@Inject(TEAM_REPOSITORY) private readonly team: TeamRepository) {}

  async execute(actor: ActorContext): Promise<TeamMember[]> {
    return this.team.listTeam(actor);
  }
}

export interface UpdateTeamMemberRequest {
  readonly actor: ActorContext;
  readonly membershipId: string;
  readonly update: TeamMemberUpdate;
}

/** Cambia rol, permisos, cargo o estado de alguien del equipo, según las reglas de quién puede tocar a quién. */
@Injectable()
export class UpdateTeamMemberUseCase {
  constructor(
    @Inject(TEAM_REPOSITORY) private readonly team: TeamRepository,
    private readonly activity: ActivityRecorder,
  ) {}

  async execute(request: UpdateTeamMemberRequest): Promise<TeamMember> {
    const { actor, membershipId, update } = request;
    const target = await this.team.findMember(actor, membershipId);
    if (!target) throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);

    const decision = decideTeamChange({
      actor,
      target,
      isChangingRole: update.role !== undefined,
      isChangingStatus: update.status !== undefined,
      newRole: update.role,
    });
    if (decision === 'not_a_team_member') throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
    if (decision === 'forbidden') {
      throw new DomainError('TEAM_CHANGE_NOT_ALLOWED', HTTP_STATUS.forbidden);
    }
    const updated = await this.team.updateMember(actor, membershipId, update);
    await this.activity.record(actor, { kind: 'team_member_updated', subject: updated.fullName });
    return updated;
  }
}
