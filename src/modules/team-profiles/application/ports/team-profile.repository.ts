import { type ActorContext } from '../../../../shared/tenancy/actor-context';
import { type StoredVideo } from '../../../videos/application/ports/video.repository';
import { type RatingSummary, type StaffProfileStatusName } from '../../domain/profile-rules';

export interface CertificationView {
  readonly id: string;
  readonly name: string;
  readonly detail: string | null;
  readonly isVerified: boolean;
}

export interface ProfileView {
  readonly membershipId: string;
  readonly role: 'owner' | 'admin' | 'staff';
  readonly fullName: string;
  readonly staffTitle: string | null;
  readonly headline: string | null;
  readonly bio: string | null;
  readonly specialties: readonly string[];
  readonly languages: readonly string[];
  readonly status: StaffProfileStatusName;
  readonly reviewNote: string | null;
  readonly hasPublishConsent: boolean;
  readonly certifications: readonly CertificationView[];
  readonly introVideo: StoredVideo | null;
  readonly techniqueVideos: readonly StoredVideo[];
  readonly rating: RatingSummary | null;
}

export interface ProfileContent {
  readonly headline: string | null;
  readonly bio: string | null;
  readonly specialties: readonly string[];
  readonly languages: readonly string[];
  readonly hasPublishConsent: boolean;
}

export type ReviewProfileOutcome =
  { readonly kind: 'reviewed' } | { readonly kind: 'not_found' } | { readonly kind: 'not_pending' };

export type AddCertificationOutcome =
  { readonly kind: 'added' } | { readonly kind: 'limit_reached' };

export interface TeamSettings {
  readonly showTeamOnWeb: boolean;
  readonly reviewsNeedApproval: boolean;
}

export interface TeamProfileRepository {
  /** Todo el equipo activo (propietario, administración y quien da las sesiones), con o sin perfil escrito. */
  listProfiles(actor: ActorContext): Promise<ProfileView[]>;
  findProfile(actor: ActorContext, membershipId: string): Promise<ProfileView | null>;
  /** Guarda lo que la persona escribe; el perfil vuelve a borrador. */
  saveContent(actor: ActorContext, content: ProfileContent): Promise<void>;
  /** Cambia el estado al enviarlo; si espera revisión, avisa a la administración. */
  submit(actor: ActorContext, status: 'pending' | 'published'): Promise<void>;
  review(
    actor: ActorContext,
    request: { membershipId: string; isApproved: boolean; note: string | null },
  ): Promise<ReviewProfileOutcome>;
  addCertification(
    actor: ActorContext,
    certification: { id: string; name: string; detail: string | null },
  ): Promise<AddCertificationOutcome>;
  removeCertification(actor: ActorContext, certificationId: string): Promise<boolean>;
  verifyCertification(actor: ActorContext, certificationId: string): Promise<boolean>;
  readSettings(actor: ActorContext): Promise<TeamSettings>;
  saveSettings(actor: ActorContext, settings: Partial<TeamSettings>): Promise<TeamSettings>;
}

export const TEAM_PROFILE_REPOSITORY = Symbol('TEAM_PROFILE_REPOSITORY');
