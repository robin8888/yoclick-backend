const BYTES_PER_MEGABYTE = 1_048_576;
const MAX_PHOTO_SIZE_MEGABYTES = 5;
/** La app reduce la foto antes de subirla: cinco megas sobran y protegen el almacén. */
export const MAX_PHOTO_SIZE_BYTES = MAX_PHOTO_SIZE_MEGABYTES * BYTES_PER_MEGABYTE;
/**
 * Tope del cuerpo que acepta el servidor. Es el doble del permitido para que una foto pasada de
 * tamaño reciba el mensaje claro `PHOTO_TOO_LARGE` y no un 413 genérico; más allá se corta la subida.
 */
export const MAX_PHOTO_REQUEST_BODY_BYTES = MAX_PHOTO_SIZE_BYTES + MAX_PHOTO_SIZE_BYTES;
export const GALLERY_MAX_PHOTOS = 6;

export const PHOTO_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
/** Tipo con el que se trata cualquier subida de foto: lo que diga el móvil no decide nada. */
export const PHOTO_PARSER_CONTENT_TYPE = 'image/jpeg';

export type PhotoFormat = 'jpeg' | 'png' | 'webp';

export const PHOTO_FILE_EXTENSIONS: Readonly<Record<PhotoFormat, string>> = {
  jpeg: 'jpg',
  png: 'png',
  webp: 'webp',
};

const JPEG_SIGNATURE = Buffer.from('ffd8ff', 'hex');
const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');
const RIFF_SIGNATURE = 'RIFF';
const WEBP_SIGNATURE = 'WEBP';
const WEBP_FORMAT_OFFSET = 8;
const WEBP_HEADER_LENGTH = 12;

function startsWith(bytes: Buffer, signature: Buffer): boolean {
  return bytes.subarray(0, signature.length).equals(signature);
}

function isWebp(bytes: Buffer): boolean {
  if (bytes.length < WEBP_HEADER_LENGTH) return false;
  return (
    bytes.subarray(0, RIFF_SIGNATURE.length).toString('latin1') === RIFF_SIGNATURE &&
    bytes.subarray(WEBP_FORMAT_OFFSET, WEBP_HEADER_LENGTH).toString('latin1') === WEBP_SIGNATURE
  );
}

/** El formato se lee de los primeros bytes del fichero; ni la extensión ni el tipo que diga el móvil se fían. */
export function detectPhotoFormat(bytes: Buffer): PhotoFormat | null {
  if (startsWith(bytes, JPEG_SIGNATURE)) return 'jpeg';
  if (startsWith(bytes, PNG_SIGNATURE)) return 'png';
  if (isWebp(bytes)) return 'webp';
  return null;
}

export type PhotoUploadDecision =
  | { readonly kind: 'accepted'; readonly format: PhotoFormat }
  | { readonly kind: 'not_an_image' }
  | { readonly kind: 'too_large' };

export function decidePhotoUpload(bytes: Buffer): PhotoUploadDecision {
  const format = detectPhotoFormat(bytes);
  if (format === null) return { kind: 'not_an_image' };
  if (bytes.length > MAX_PHOTO_SIZE_BYTES) return { kind: 'too_large' };
  return { kind: 'accepted', format };
}

/** La foto de perfil de una persona: una sola, con su propio nombre cada vez para no servir una caché vieja. */
export function buildAvatarKey(request: {
  userId: string;
  photoId: string;
  format: PhotoFormat;
}): string {
  return `photos/avatars/${request.userId}/${request.photoId}.${PHOTO_FILE_EXTENSIONS[request.format]}`;
}

export function buildGalleryPhotoKey(request: {
  centerId: string;
  membershipId: string;
  photoId: string;
  format: PhotoFormat;
}): string {
  const folder = `photos/gallery/${request.centerId}/${request.membershipId}`;
  return `${folder}/${request.photoId}.${PHOTO_FILE_EXTENSIONS[request.format]}`;
}

export function isGalleryFull(currentPhotoCount: number): boolean {
  return currentPhotoCount >= GALLERY_MAX_PHOTOS;
}

export type GalleryQuotaDecision = 'allowed' | 'quota_exceeded';

export interface GalleryQuotaFacts {
  readonly storageLimitBytes: bigint;
  /** Lo que ya ocupan las fotos de galería de todo el equipo del centro. */
  readonly usedBytes: bigint;
  readonly requestedBytes: bigint;
}

/** Cada centro tiene un tope de espacio de fotos: un centro descuidado o malicioso no puede subir sin límite. */
export function decideGalleryQuota(facts: GalleryQuotaFacts): GalleryQuotaDecision {
  const isOverQuota = facts.usedBytes + facts.requestedBytes > facts.storageLimitBytes;
  return isOverQuota ? 'quota_exceeded' : 'allowed';
}
