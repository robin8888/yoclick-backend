import {
  type VideoHosting,
  type VideoPlaybackLinks,
  type VideoProcessingState,
  type VideoUploadTarget,
} from '../application/ports/video-hosting';
import { MILLISECONDS_PER_HOUR } from '../../../shared/time/time-units';
import { signCdnDirectoryUrl, signTusUpload, toUnixSeconds } from './bunny-signatures';

const API_BASE_URL = 'https://video.bunnycdn.com';
const TUS_UPLOAD_URL = `${API_BASE_URL}/tusupload`;
const REQUEST_TIMEOUT_MS = 10_000;
/** La subida de un vídeo grande desde el móvil puede tardar: la firma dura lo suficiente para reanudarla. */
const UPLOAD_SIGNATURE_LIFETIME_HOURS = 6;
const UPLOAD_SIGNATURE_LIFETIME_MS = UPLOAD_SIGNATURE_LIFETIME_HOURS * MILLISECONDS_PER_HOUR;
/** El enlace de reproducción dura lo que una sesión de práctica; la app pide otro al abrir la pantalla. */
const PLAYBACK_LINK_LIFETIME_HOURS = 4;
const PLAYBACK_LINK_LIFETIME_MS = PLAYBACK_LINK_LIFETIME_HOURS * MILLISECONDS_PER_HOUR;
const HTTP_NOT_FOUND = 404;

export interface BunnyStreamSettings {
  readonly libraryId: string;
  readonly apiKey: string;
  readonly tokenKey: string;
  readonly cdnHostname: string;
}

interface BunnyVideoResponse {
  readonly guid: string;
  readonly status: number;
  readonly storageSize?: number;
  readonly length?: number;
}

/** Aloja los vídeos en Bunny Stream. Las claves solo viven en el servidor y nunca llegan al móvil. */
export class BunnyStreamVideoHosting implements VideoHosting {
  constructor(private readonly settings: BunnyStreamSettings) {}

  async createVideo(title: string): Promise<{ providerVideoId: string }> {
    const response = await this.request('POST', '/videos', { title });
    const created = (await response.json()) as BunnyVideoResponse;
    return { providerVideoId: created.guid };
  }

  signUpload(providerVideoId: string): VideoUploadTarget {
    const expiresAt = new Date(Date.now() + UPLOAD_SIGNATURE_LIFETIME_MS);
    const expiresAtUnixSeconds = toUnixSeconds(expiresAt);
    return {
      endpoint: TUS_UPLOAD_URL,
      headers: {
        AuthorizationSignature: signTusUpload({
          libraryId: this.settings.libraryId,
          apiKey: this.settings.apiKey,
          expiresAtUnixSeconds,
          providerVideoId,
        }),
        AuthorizationExpire: String(expiresAtUnixSeconds),
        VideoId: providerVideoId,
        LibraryId: this.settings.libraryId,
      },
      expiresAt,
    };
  }

  async fetchProcessingState(providerVideoId: string): Promise<VideoProcessingState | null> {
    const response = await this.request('GET', `/videos/${providerVideoId}`);
    if (response.status === HTTP_NOT_FOUND) return null;
    const video = (await response.json()) as BunnyVideoResponse;
    return {
      bunnyStatusCode: video.status,
      sizeBytes: BigInt(Math.trunc(video.storageSize ?? 0)),
      durationSeconds: video.length === undefined ? null : Math.round(video.length),
    };
  }

  signPlayback(providerVideoId: string): VideoPlaybackLinks {
    const expiresAt = new Date(Date.now() + PLAYBACK_LINK_LIFETIME_MS);
    const sign = (filePath: string): string =>
      signCdnDirectoryUrl({
        hostname: this.settings.cdnHostname,
        tokenKey: this.settings.tokenKey,
        directoryPath: `/${providerVideoId}/`,
        filePath: `/${providerVideoId}/${filePath}`,
        expiresAtUnixSeconds: toUnixSeconds(expiresAt),
      });
    return {
      streamUrl: sign('playlist.m3u8'),
      thumbnailUrl: sign('thumbnail.jpg'),
      expiresAt,
    };
  }

  async deleteVideo(providerVideoId: string): Promise<void> {
    const response = await this.request('DELETE', `/videos/${providerVideoId}`);
    if (response.status === HTTP_NOT_FOUND) return;
  }

  private async request(method: string, path: string, body?: unknown): Promise<Response> {
    const response = await fetch(`${API_BASE_URL}/library/${this.settings.libraryId}${path}`, {
      method,
      headers: {
        AccessKey: this.settings.apiKey,
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok && response.status !== HTTP_NOT_FOUND) {
      // El cuerpo puede traer detalles de la cuenta: solo se deja el código.
      throw new Error(`Bunny Stream answered ${String(response.status)} to ${method} ${path}`);
    }
    return response;
  }
}
