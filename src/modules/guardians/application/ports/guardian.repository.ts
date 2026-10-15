import { type ActorContext } from '../../../../shared/tenancy/actor-context';

export interface GuardianView {
  readonly membershipId: string;
  readonly fullName: string;
  readonly email: string;
}

export type LinkGuardianOutcome =
  | { readonly kind: 'linked' }
  | { readonly kind: 'not_found' }
  /** El tutor tiene que ser una persona adulta; el hijo, una persona cliente del centro. */
  | { readonly kind: 'guardian_is_minor' }
  | { readonly kind: 'invalid_people' }
  | { readonly kind: 'already_linked' };

export interface ChildBookingView {
  readonly id: string;
  readonly serviceName: string;
  readonly startsAt: Date;
  readonly teacherName: string;
}

export interface ChildView {
  readonly membershipId: string;
  readonly fullName: string;
  readonly photoKey: string | null;
  readonly isMinor: boolean;
  readonly upcomingBookings: readonly ChildBookingView[];
  /** Clases que le quedan en sus bonos vigentes. */
  readonly remainingSessions: number;
}

export interface GuardianRepository {
  listGuardiansOf(actor: ActorContext, childMembershipId: string): Promise<GuardianView[] | null>;
  linkGuardian(
    actor: ActorContext,
    request: { guardianMembershipId: string; childMembershipId: string; now: Date },
  ): Promise<LinkGuardianOutcome>;
  /** `false` si no existía ese enlace. */
  unlinkGuardian(
    actor: ActorContext,
    request: { guardianMembershipId: string; childMembershipId: string },
  ): Promise<boolean>;
  listMyChildren(actor: ActorContext, now: Date): Promise<ChildView[]>;
}

export const GUARDIAN_REPOSITORY = Symbol('GUARDIAN_REPOSITORY');
