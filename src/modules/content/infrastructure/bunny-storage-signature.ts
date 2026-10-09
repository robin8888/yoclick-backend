import { createHash } from 'node:crypto';

/**
 * Enlace firmado de un fichero del pull zone: token = base64url(SHA256(clave + ruta + caducidad)).
 * Es la autenticación por token básica de Bunny, que solo vale para esa ruta hasta que caduca.
 */
export function signStorageDownloadUrl(request: {
  readonly hostname: string;
  readonly tokenKey: string;
  readonly path: string;
  readonly expiresAtUnixSeconds: number;
}): string {
  const expires = String(request.expiresAtUnixSeconds);
  const token = createHash('sha256')
    .update(`${request.tokenKey}${request.path}${expires}`)
    .digest('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
  return `https://${request.hostname}${request.path}?token=${token}&expires=${expires}`;
}
