import { Inject, Injectable } from '@nestjs/common';
import { v7 as generateUuidV7 } from 'uuid';
import { DomainError } from '../../../shared/errors/domain-error';
import { HTTP_STATUS } from '../../../shared/errors/http-status';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { decideNewReviewStatus } from '../domain/profile-rules';
import {
  STAFF_REVIEW_REPOSITORY,
  type StaffReviewRepository,
  type StaffReviewView,
} from './ports/staff-review.repository';
import {
  TEAM_PROFILE_REPOSITORY,
  type TeamProfileRepository,
} from './ports/team-profile.repository';

@Injectable()
export class CreateStaffReviewUseCase {
  constructor(
    @Inject(STAFF_REVIEW_REPOSITORY) private readonly reviews: StaffReviewRepository,
    @Inject(TEAM_PROFILE_REPOSITORY) private readonly profiles: TeamProfileRepository,
  ) {}

  /** Solo se opina de una sesión que ocurrió con esa persona y una vez por sesión. */
  async execute(request: {
    actor: ActorContext;
    staffMembershipId: string;
    rating: number;
    comment: string | null;
  }): Promise<StaffReviewView> {
    const staff = await this.profiles.findProfile(request.actor, request.staffMembershipId);
    if (!staff) throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
    const shouldReviewFirst = await this.reviews.readReviewsNeedApproval(request.actor);
    const outcome = await this.reviews.create(request.actor, {
      id: generateUuidV7(),
      staffMembershipId: request.staffMembershipId,
      rating: request.rating,
      comment: request.comment,
      status: decideNewReviewStatus(shouldReviewFirst),
    });
    if (outcome.kind === 'not_eligible') {
      throw new DomainError('REVIEW_NOT_ALLOWED', HTTP_STATUS.conflict);
    }
    return outcome.review;
  }
}

@Injectable()
export class ListStaffReviewsUseCase {
  constructor(@Inject(STAFF_REVIEW_REPOSITORY) private readonly reviews: StaffReviewRepository) {}

  listPublished(actor: ActorContext, staffMembershipId: string): Promise<StaffReviewView[]> {
    return this.reviews.listPublished(actor, staffMembershipId);
  }

  listPending(actor: ActorContext): Promise<StaffReviewView[]> {
    return this.reviews.listPending(actor);
  }
}

@Injectable()
export class ModerateStaffReviewUseCase {
  constructor(@Inject(STAFF_REVIEW_REPOSITORY) private readonly reviews: StaffReviewRepository) {}

  async execute(request: {
    actor: ActorContext;
    reviewId: string;
    isApproved: boolean;
  }): Promise<StaffReviewView> {
    const outcome = await this.reviews.moderate(request.actor, request);
    if (outcome.kind === 'not_found') throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
    if (outcome.kind === 'not_pending') {
      throw new DomainError('REVIEW_NOT_MODERABLE', HTTP_STATUS.conflict);
    }
    return outcome.review;
  }
}
