import { type ActorContext } from '../../../../shared/tenancy/actor-context';
import { type VideoReviewStatusName, type VideoStatusName } from '../../domain/video-rules';

export interface StoredVideo {
  readonly id: string;
  readonly providerVideoId: string;
  readonly title: string;
  readonly status: VideoStatusName;
  readonly reviewStatus: VideoReviewStatusName;
  readonly reviewNote: string | null;
  readonly sizeBytes: bigint;
  readonly durationSeconds: number | null;
  readonly uploadedByMembershipId: string;
}

export interface NewVideo {
  readonly id: string;
  readonly providerVideoId: string;
  readonly title: string;
  readonly requestedBytes: bigint;
  readonly reviewStatus: VideoReviewStatusName;
  /** Si se indica, es el vídeo de presentación de esa persona y sustituye al anterior. */
  readonly profileOfMembershipId: string | null;
}

export interface VideoStorageFacts {
  readonly storageLimitBytes: bigint | null;
  readonly usedBytes: bigint;
}

export interface TeamProfileView {
  readonly membershipId: string;
  readonly fullName: string;
  readonly staffTitle: string | null;
  readonly video: StoredVideo | null;
}

export interface ProcessingUpdate {
  readonly status: VideoStatusName;
  readonly sizeBytes: bigint;
  readonly durationSeconds: number | null;
}

export type ReviewOutcome =
  | { readonly kind: 'reviewed'; readonly video: StoredVideo }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'not_reviewable' };

export interface VideoRepository {
  readStorageFacts(actor: ActorContext): Promise<VideoStorageFacts>;
  /** Crea el vídeo y devuelve el de presentación anterior (si lo había) para borrarlo del servicio. */
  create(actor: ActorContext, video: NewVideo): Promise<{ replacedProviderVideoId: string | null }>;
  find(actor: ActorContext, videoId: string): Promise<StoredVideo | null>;
  /** Guarda lo que dice el servicio de vídeo; al quedar listo un vídeo pendiente de revisión avisa a la administración. */
  applyProcessingUpdate(
    actor: ActorContext,
    videoId: string,
    update: ProcessingUpdate,
  ): Promise<StoredVideo | null>;
  delete(actor: ActorContext, videoId: string): Promise<void>;
  review(
    actor: ActorContext,
    request: { videoId: string; isApproved: boolean; note: string | null },
  ): Promise<ReviewOutcome>;
  listTeamProfiles(actor: ActorContext): Promise<TeamProfileView[]>;
}

export const VIDEO_REPOSITORY = Symbol('VIDEO_REPOSITORY');
