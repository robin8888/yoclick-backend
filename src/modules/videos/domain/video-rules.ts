import { MILLISECONDS_PER_DAY } from '../../../shared/time/time-units';

const BYTES_PER_MEGABYTE = 1_048_576;
const MAX_VIDEO_SIZE_MEGABYTES = 500;
export const MAX_VIDEO_SIZE_BYTES = MAX_VIDEO_SIZE_MEGABYTES * BYTES_PER_MEGABYTE;
/**
 * Subidas a medias que puede tener un centro a la vez. Cada una reserva un hueco en el servicio de
 * vídeo antes de saber lo que pesa de verdad, así que sin tope se podría llenar con reservas.
 */
export const MAX_VIDEO_UPLOADS_IN_PROGRESS = 5;
/** Una subida que lleva tanto sin empezar a procesarse se da por abandonada: ni cuenta ni ocupa sitio. */
export const STALE_UPLOAD_AFTER_MS = MILLISECONDS_PER_DAY;
export const MAX_VIDEO_TITLE_LENGTH = 120;
export const MAX_REVIEW_NOTE_LENGTH = 300;

export type VideoStatusName = 'uploading' | 'processing' | 'ready' | 'failed';
export type VideoReviewStatusName = 'approved' | 'pending' | 'changes_requested';

/** Estados de Bunny Stream: 0 creado, 1 subido, 2 procesando, 3 transcodificando, 4 terminado, 5 error, 6 fallo de subida. */
const BUNNY_STATUS_TO_VIDEO_STATUS: Readonly<Record<number, VideoStatusName>> = {
  0: 'uploading',
  1: 'processing',
  2: 'processing',
  3: 'processing',
  4: 'ready',
  5: 'failed',
  6: 'failed',
  // Generación de segmentos al vuelo: ya se puede reproducir.
  7: 'ready',
  8: 'ready',
};

export function mapBunnyStatusToVideoStatus(bunnyStatusCode: number): VideoStatusName {
  return BUNNY_STATUS_TO_VIDEO_STATUS[bunnyStatusCode] ?? 'processing';
}

export type VideoUploadDecision =
  'allowed' | 'not_included' | 'too_large' | 'too_many_in_progress' | 'quota_exceeded';

export interface VideoUploadFacts {
  /** Espacio contratado; `null` si el plan no incluye vídeo. */
  readonly storageLimitBytes: bigint | null;
  readonly usedBytes: bigint;
  readonly requestedBytes: bigint;
  /** Vídeos del centro que se están subiendo o procesando (sin contar las subidas abandonadas). */
  readonly uploadsInProgressCount: number;
}

/** El plan decide si hay vídeo y cuánto cabe; la app solo oculta el botón, esto es lo que manda. */
export function decideVideoUpload(facts: VideoUploadFacts): VideoUploadDecision {
  if (facts.storageLimitBytes === null) return 'not_included';
  if (facts.requestedBytes > BigInt(MAX_VIDEO_SIZE_BYTES)) return 'too_large';
  if (facts.uploadsInProgressCount >= MAX_VIDEO_UPLOADS_IN_PROGRESS) return 'too_many_in_progress';
  const isOverQuota = facts.usedBytes + facts.requestedBytes > facts.storageLimitBytes;
  return isOverQuota ? 'quota_exceeded' : 'allowed';
}

/** Los clientes solo ven vídeos listos y aprobados por el centro. */
export function isVideoVisibleToClients(video: {
  readonly status: VideoStatusName;
  readonly reviewStatus: VideoReviewStatusName;
}): boolean {
  return video.status === 'ready' && video.reviewStatus === 'approved';
}

export type ReportedVideoSizeDecision = 'accepted' | 'too_large' | 'quota_exceeded';

export interface ReportedVideoSizeFacts {
  /** Lo que el servicio de vídeo dice que ocupa de verdad (no lo que declaró el móvil). */
  readonly reportedBytes: bigint;
  /** `null` si el plan ya no incluye vídeo: no se castiga lo que ya estaba subido. */
  readonly storageLimitBytes: bigint | null;
  /** Lo que ocupan el resto de vídeos del centro, sin este. */
  readonly usedByOtherVideosBytes: bigint;
}

/**
 * El móvil declara un tamaño al reservar y el servidor se lo cree solo hasta saber el real: cuando
 * llega, manda el real. Así declarar poco y subir mucho no sirve para saltarse el tope.
 */
export function decideReportedVideoSize(facts: ReportedVideoSizeFacts): ReportedVideoSizeDecision {
  if (facts.reportedBytes > BigInt(MAX_VIDEO_SIZE_BYTES)) return 'too_large';
  if (facts.storageLimitBytes === null) return 'accepted';
  const isOverQuota = facts.usedByOtherVideosBytes + facts.reportedBytes > facts.storageLimitBytes;
  return isOverQuota ? 'quota_exceeded' : 'accepted';
}

export function isUploadStale(createdAt: Date, now: Date): boolean {
  return now.getTime() - createdAt.getTime() > STALE_UPLOAD_AFTER_MS;
}
