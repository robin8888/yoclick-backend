import { Module } from '@nestjs/common';
import {
  AcceptInvitationUseCase,
  GetInvitationPreviewUseCase,
  InviteToCenterUseCase,
  ListPendingInvitationsUseCase,
  RevokeInvitationUseCase,
} from './application/invitation.use-cases';
import { INVITATION_REPOSITORY } from './application/ports/invitation.repository';
import { TEAM_REPOSITORY } from './application/ports/team.repository';
import { ListTeamUseCase, UpdateTeamMemberUseCase } from './application/team.use-cases';
import { InvitationJoinController } from './http/invitation-join.controller';
import { TeamController } from './http/team.controller';
import { PrismaInvitationRepository } from './infrastructure/prisma-invitation.repository';
import { PrismaTeamRepository } from './infrastructure/prisma-team.repository';

@Module({
  controllers: [TeamController, InvitationJoinController],
  providers: [
    ListTeamUseCase,
    UpdateTeamMemberUseCase,
    InviteToCenterUseCase,
    ListPendingInvitationsUseCase,
    RevokeInvitationUseCase,
    GetInvitationPreviewUseCase,
    AcceptInvitationUseCase,
    { provide: TEAM_REPOSITORY, useClass: PrismaTeamRepository },
    { provide: INVITATION_REPOSITORY, useClass: PrismaInvitationRepository },
  ],
})
export class TeamModule {}
