import { MILLISECONDS_PER_HOUR } from '../../../shared/time/time-units';
import { toUnixSeconds } from '../../videos/infrastructure/bunny-signatures';
import { type DocumentDownloadLink, type FileStorage } from '../application/ports/file-storage';
import { signStorageDownloadUrl } from './bunny-storage-signature';

/** Un PDF de 50 MB sube desde el servidor en pocos segundos; esto deja margen a una conexión lenta. */
const REQUEST_TIMEOUT_MS = 60_000;
/** El enlace de descarga dura lo que una lectura; la app pide otro al abrir el documento. */
const DOWNLOAD_LINK_LIFETIME_HOURS = 2;
const DOWNLOAD_LINK_LIFETIME_MS = DOWNLOAD_LINK_LIFETIME_HOURS * MILLISECONDS_PER_HOUR;
const HTTP_NOT_FOUND = 404;

export interface BunnyStorageSettings {
  readonly zone: string;
  readonly apiKey: string;
  /** Servidor de la región de la zona, p. ej. `storage.bunnycdn.com` (Falkenstein). */
  readonly storageHost: string;
  readonly cdnHostname: string;
  readonly tokenKey: string;
  /** Si el pull zone exige token en cada petición; si no, el enlace firmado no existe y da 403. */
  readonly isTokenAuthEnabled: boolean;
}

/** Guarda los PDF en Bunny Storage. La clave solo vive en el servidor y nunca llega al móvil. */
export class BunnyFileStorage implements FileStorage {
  constructor(private readonly settings: BunnyStorageSettings) {}

  async putFile(request: { readonly key: string; readonly bytes: Buffer }): Promise<void> {
    await this.request('PUT', request.key, new Uint8Array(request.bytes));
  }

  async deleteFile(key: string): Promise<void> {
    await this.request('DELETE', key);
  }

  signDownload(key: string): DocumentDownloadLink {
    const expiresAt = new Date(Date.now() + DOWNLOAD_LINK_LIFETIME_MS);
    const path = `/${key}`;
    if (!this.settings.isTokenAuthEnabled) {
      return { url: `https://${this.settings.cdnHostname}${path}`, expiresAt };
    }
    return {
      url: signStorageDownloadUrl({
        hostname: this.settings.cdnHostname,
        tokenKey: this.settings.tokenKey,
        path,
        expiresAtUnixSeconds: toUnixSeconds(expiresAt),
      }),
      expiresAt,
    };
  }

  private async request(method: 'PUT' | 'DELETE', key: string, body?: Uint8Array): Promise<void> {
    const response = await fetch(
      `https://${this.settings.storageHost}/${this.settings.zone}/${key}`,
      {
        method,
        headers: {
          AccessKey: this.settings.apiKey,
          ...(body !== undefined && { 'Content-Type': 'application/octet-stream' }),
        },
        ...(body !== undefined && { body }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
    if (!response.ok && !(method === 'DELETE' && response.status === HTTP_NOT_FOUND)) {
      // El cuerpo puede traer detalles de la cuenta: solo se deja el código.
      throw new Error(`Bunny Storage answered ${String(response.status)} to ${method} ${key}`);
    }
  }
}
