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

/** A qué parte del perfil del equipo pertenece el vídeo; sin esto es el vídeo de un ejercicio. */
export type VideoAttachment =
  /** Su vídeo de presentación: sustituye al anterior. */
  | { readonly kind: 'profile'; readonly membershipId: string }
  /** Uno de sus (hasta tres) vídeos de técnica. */
  | { readonly kind: 'technique'; readonly membershipId: string };

/** Un vídeo que aún se sube o se procesa; `createdAt` sirve para descartar las subidas abandonadas. */
export interface InFlightVideo extends StoredVideo {
  readonly createdAt: Date;
}

export interface NewVideo {
  readonly id: string;
  readonly providerVideoId: string;
  readonly title: string;
  readonly requestedBytes: bigint;
  readonly attachment: VideoAttachment | null;
}

export interface VideoStorageFacts {
  readonly storageLimitBytes: bigint | null;
  readonly usedBytes: bigint;
}

export interface ProcessingUpdate {
  readonly status: VideoStatusName;
  readonly sizeBytes: bigint;
  readonly durationSeconds: number | null;
}

export interface VideoRepository {
  readStorageFacts(actor: ActorContext): Promise<VideoStorageFacts>;
  /** Vídeos subiéndose o procesándose, los más antiguos primero. */
  listInFlight(actor: ActorContext): Promise<InFlightVideo[]>;
  /** Cuántos se están subiendo o procesando; no cuenta los que siguen sin subirse desde `abandonedBefore`. */
  countUploadsInProgress(actor: ActorContext, abandonedBefore: Date): Promise<number>;
  countTechniqueVideos(actor: ActorContext, membershipId: string): Promise<number>;
  /**
   * Crea el vídeo y devuelve el de presentación anterior (si lo había) para borrarlo del servicio.
   * Si es del perfil del equipo, el perfil vuelve a borrador: hay que enviarlo otra vez a revisión.
   */
  create(actor: ActorContext, video: NewVideo): Promise<{ replacedProviderVideoId: string | null }>;
  find(actor: ActorContext, videoId: string): Promise<StoredVideo | null>;
  applyProcessingUpdate(
    actor: ActorContext,
    videoId: string,
    update: ProcessingUpdate,
  ): Promise<StoredVideo | null>;
  delete(actor: ActorContext, videoId: string): Promise<void>;
}

export const VIDEO_REPOSITORY = Symbol('VIDEO_REPOSITORY');
