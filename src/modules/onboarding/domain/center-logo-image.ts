export const MAX_LOGO_BYTES = 716_800;

export const LOGO_CONTENT_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type LogoContentType = (typeof LOGO_CONTENT_TYPES)[number];

export interface LogoUpload {
  readonly contentType: LogoContentType;
  readonly dataBase64: string;
}

export type LogoValidation =
  | { readonly kind: 'valid'; readonly bytes: Buffer; readonly contentType: LogoContentType }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'too_large' };

const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;
const BASE64_BLOCK_LENGTH = 4;
const BYTES_PER_BASE64_BLOCK = 3;
const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');
const JPEG_SIGNATURE = Buffer.from('ffd8ff', 'hex');
const RIFF_SIGNATURE = Buffer.from('RIFF', 'ascii');
const WEBP_SIGNATURE = Buffer.from('WEBP', 'ascii');
const DOUBLE_PADDING = '==';
const SINGLE_PADDING = '=';
const RIFF_SIZE_FIELD_BYTES = 4;
const WEBP_MARKER_OFFSET = RIFF_SIGNATURE.length + RIFF_SIZE_FIELD_BYTES;

function startsWithBytes(bytes: Buffer, signature: Buffer, offset = 0): boolean {
  return bytes.subarray(offset, offset + signature.length).equals(signature);
}

function isWebp(bytes: Buffer): boolean {
  return (
    startsWithBytes(bytes, RIFF_SIGNATURE) &&
    startsWithBytes(bytes, WEBP_SIGNATURE, WEBP_MARKER_OFFSET)
  );
}

/** El formato real lo dicen los primeros bytes, no lo que declare el cliente. */
function detectImageFormat(bytes: Buffer): LogoContentType | null {
  if (startsWithBytes(bytes, PNG_SIGNATURE)) return 'image/png';
  if (startsWithBytes(bytes, JPEG_SIGNATURE)) return 'image/jpeg';
  if (isWebp(bytes)) return 'image/webp';
  return null;
}

function countPaddingCharacters(dataBase64: string): number {
  if (dataBase64.endsWith(DOUBLE_PADDING)) return DOUBLE_PADDING.length;
  return dataBase64.endsWith(SINGLE_PADDING) ? SINGLE_PADDING.length : 0;
}

/** Tamaño decodificado calculado sin decodificar, para no reservar memoria con un cuerpo enorme. */
function measureDecodedBytes(dataBase64: string): number {
  const blockCount = dataBase64.length / BASE64_BLOCK_LENGTH;
  return blockCount * BYTES_PER_BASE64_BLOCK - countPaddingCharacters(dataBase64);
}

function isStrictBase64(dataBase64: string): boolean {
  return (
    dataBase64.length > 0 &&
    dataBase64.length % BASE64_BLOCK_LENGTH === 0 &&
    BASE64_PATTERN.test(dataBase64)
  );
}

/**
 * Valida un logo subido: base64 estricto, tamaño máximo y formato real (PNG, JPEG o WebP) que
 * coincida con el declarado. SVG y cualquier otro formato se rechazan (pueden llevar scripts).
 */
export function validateLogoUpload(upload: LogoUpload): LogoValidation {
  if (!isStrictBase64(upload.dataBase64)) return { kind: 'invalid' };
  if (measureDecodedBytes(upload.dataBase64) > MAX_LOGO_BYTES) return { kind: 'too_large' };

  const bytes = Buffer.from(upload.dataBase64, 'base64');
  if (detectImageFormat(bytes) !== upload.contentType) return { kind: 'invalid' };
  return { kind: 'valid', bytes, contentType: upload.contentType };
}
