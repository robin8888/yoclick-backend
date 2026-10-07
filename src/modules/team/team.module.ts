import { Module } from '@nestjs/common';
import {
  AcceptInvitationUseCase,
  GetInvitationPreviewUseCase,
  InviteToCenterUseCase,
  ListPendingInvitationsUseCase,
  RevokeInvitationUseCase,
} from './application/invitation.use-cases';
import {
  AddStaffAbsenceUseCase,
  GetStaffAvailabilityUseCase,
  RemoveStaffAbsenceUseCase,
  SaveStaffWeeklyHoursUseCase,
} from './application/staff-availability.use-cases';
import { STAFF_AVAILABILITY_REPOSITORY } from './application/ports/staff-availability.repository';
import { StaffAvailabilityController } from './http/staff-availability.controller';
import { PrismaStaffAvailabilityRepository } from './infrastructure/prisma-staff-availability.repository';
import { INVITATION_REPOSITORY } from './application/ports/invitation.repository';
import { TEAM_REPOSITORY } from './application/ports/team.repository';
import { ListTeamUseCase, UpdateTeamMemberUseCase } from './application/team.use-cases';
import { InvitationJoinController } from './http/invitation-join.controller';
import { TeamController } from './http/team.controller';
import { PrismaInvitationRepository } from './infrastructure/prisma-invitation.repository';
import { PrismaTeamRepository } from './infrastructure/prisma-team.repository';

@Module({
  controllers: [TeamController, StaffAvailabilityController, InvitationJoinController],
  providers: [
    ListTeamUseCase,
    UpdateTeamMemberUseCase,
    InviteToCenterUseCase,
    ListPendingInvitationsUseCase,
    RevokeInvitationUseCase,
    GetInvitationPreviewUseCase,
    AcceptInvitationUseCase,
    GetStaffAvailabilityUseCase,
    SaveStaffWeeklyHoursUseCase,
    AddStaffAbsenceUseCase,
    RemoveStaffAbsenceUseCase,
    { provide: STAFF_AVAILABILITY_REPOSITORY, useClass: PrismaStaffAvailabilityRepository },
    { provide: TEAM_REPOSITORY, useClass: PrismaTeamRepository },
    { provide: INVITATION_REPOSITORY, useClass: PrismaInvitationRepository },
  ],
})
export class TeamModule {}
