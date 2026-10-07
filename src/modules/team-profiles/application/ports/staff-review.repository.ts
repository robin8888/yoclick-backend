import { type ActorContext } from '../../../../shared/tenancy/actor-context';

export interface StaffReviewView {
  readonly id: string;
  readonly staffMembershipId: string;
  readonly staffName: string;
  /** Nombre y la inicial del apellido («Marta R.»): la opinión no enseña quién es del todo. */
  readonly authorLabel: string;
  readonly rating: number;
  readonly comment: string | null;
  readonly status: 'pending' | 'published' | 'rejected';
  readonly createdAt: Date;
}

export type CreateStaffReviewOutcome =
  | { readonly kind: 'created'; readonly review: StaffReviewView }
  /** No hay una sesión que ocurriera con esa persona sin opinión todavía. */
  | { readonly kind: 'not_eligible' };

export type ModerateStaffReviewOutcome =
  | { readonly kind: 'moderated'; readonly review: StaffReviewView }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'not_pending' };

export interface StaffReviewRepository {
  create(
    actor: ActorContext,
    review: {
      id: string;
      staffMembershipId: string;
      rating: number;
      comment: string | null;
      status: 'pending' | 'published';
    },
  ): Promise<CreateStaffReviewOutcome>;
  listPublished(actor: ActorContext, staffMembershipId: string): Promise<StaffReviewView[]>;
  listPending(actor: ActorContext): Promise<StaffReviewView[]>;
  moderate(
    actor: ActorContext,
    request: { reviewId: string; isApproved: boolean },
  ): Promise<ModerateStaffReviewOutcome>;
  readReviewsNeedApproval(actor: ActorContext): Promise<boolean>;
}

export const STAFF_REVIEW_REPOSITORY = Symbol('STAFF_REVIEW_REPOSITORY');
