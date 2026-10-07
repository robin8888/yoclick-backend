import { Module } from '@nestjs/common';
import { ProfilePresenter } from './application/profile-presenter';
import { STAFF_REVIEW_REPOSITORY } from './application/ports/staff-review.repository';
import { TEAM_PROFILE_REPOSITORY } from './application/ports/team-profile.repository';
import {
  CreateStaffReviewUseCase,
  ListStaffReviewsUseCase,
  ModerateStaffReviewUseCase,
} from './application/staff-review.use-cases';
import {
  GetTeamProfileUseCase,
  ListTeamProfilesUseCase,
  ManageMyCertificationsUseCase,
  ModerateTeamProfileUseCase,
  SaveMyProfileUseCase,
  SubmitMyProfileUseCase,
  TeamSettingsUseCase,
} from './application/team-profile.use-cases';
import {
  ProfileModerationController,
  TeamSettingsController,
} from './http/profile-moderation.controller';
import { StaffReviewsController } from './http/staff-reviews.controller';
import { MyProfileController, TeamProfilesController } from './http/team-profiles.controller';
import { PrismaStaffReviewRepository } from './infrastructure/prisma-staff-review.repository';
import { PrismaTeamProfileRepository } from './infrastructure/prisma-team-profile.repository';

/** Controladores en orden: las rutas literales (`me`, `team-settings`) antes que las de `:membershipId`. */
@Module({
  controllers: [
    MyProfileController,
    TeamSettingsController,
    StaffReviewsController,
    ProfileModerationController,
    TeamProfilesController,
  ],
  providers: [
    ProfilePresenter,
    ListTeamProfilesUseCase,
    GetTeamProfileUseCase,
    SaveMyProfileUseCase,
    SubmitMyProfileUseCase,
    ManageMyCertificationsUseCase,
    ModerateTeamProfileUseCase,
    TeamSettingsUseCase,
    CreateStaffReviewUseCase,
    ListStaffReviewsUseCase,
    ModerateStaffReviewUseCase,
    { provide: TEAM_PROFILE_REPOSITORY, useClass: PrismaTeamProfileRepository },
    { provide: STAFF_REVIEW_REPOSITORY, useClass: PrismaStaffReviewRepository },
  ],
})
export class TeamProfilesModule {}
