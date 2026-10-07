import { createHash } from 'node:crypto';

const MILLISECONDS_PER_SECOND = 1000;

export function toUnixSeconds(moment: Date): number {
  return Math.floor(moment.getTime() / MILLISECONDS_PER_SECOND);
}

function sha256(value: string, encoding: 'hex' | 'base64'): string {
  return createHash('sha256').update(value).digest(encoding);
}

/** Firma de subida TUS: SHA256(libraryId + apiKey + expiración + videoId) en hexadecimal. */
export function signTusUpload(request: {
  readonly libraryId: string;
  readonly apiKey: string;
  readonly expiresAtUnixSeconds: number;
  readonly providerVideoId: string;
}): string {
  return sha256(
    `${request.libraryId}${request.apiKey}${String(request.expiresAtUnixSeconds)}${request.providerVideoId}`,
    'hex',
  );
}

/**
 * URL de un directorio del CDN con token de Bunny: vale para `playlist.m3u8`, sus segmentos y la
 * miniatura, que cuelgan del mismo directorio. El token y la caducidad van en la ruta para que los
 * segmentos que pide el reproductor hereden la firma.
 */
export function signCdnDirectoryUrl(request: {
  readonly hostname: string;
  readonly tokenKey: string;
  readonly directoryPath: string;
  readonly filePath: string;
  readonly expiresAtUnixSeconds: number;
}): string {
  const expires = String(request.expiresAtUnixSeconds);
  const tokenPathParameter = `token_path=${request.directoryPath}`;
  const token = sha256(
    `${request.tokenKey}${request.directoryPath}${expires}${tokenPathParameter}`,
    'base64',
  )
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
  const encodedDirectory = encodeURIComponent(request.directoryPath);
  return `https://${request.hostname}/bcdn_token=${token}&expires=${expires}&token_path=${encodedDirectory}${request.filePath}`;
}
