const BYTES_PER_MEGABYTE = 1_048_576;
const MAX_VIDEO_SIZE_MEGABYTES = 500;
export const MAX_VIDEO_SIZE_BYTES = MAX_VIDEO_SIZE_MEGABYTES * BYTES_PER_MEGABYTE;
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

export type VideoUploadDecision = 'allowed' | 'not_included' | 'too_large' | 'quota_exceeded';

export interface VideoUploadFacts {
  /** Espacio contratado; `null` si el plan no incluye vídeo. */
  readonly storageLimitBytes: bigint | null;
  readonly usedBytes: bigint;
  readonly requestedBytes: bigint;
}

/** El plan decide si hay vídeo y cuánto cabe; la app solo oculta el botón, esto es lo que manda. */
export function decideVideoUpload(facts: VideoUploadFacts): VideoUploadDecision {
  if (facts.storageLimitBytes === null) return 'not_included';
  if (facts.requestedBytes > BigInt(MAX_VIDEO_SIZE_BYTES)) return 'too_large';
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
