import { v7 as generateUuidV7 } from 'uuid';
import { MILLISECONDS_PER_HOUR } from '../../../shared/time/time-units';
import {
  type VideoHosting,
  type VideoPlaybackLinks,
  type VideoProcessingState,
  type VideoUploadTarget,
} from '../application/ports/video-hosting';

const FAKE_HOST = 'https://fake-video.invalid';
const LINK_LIFETIME_MS = MILLISECONDS_PER_HOUR;
const BUNNY_FINISHED_STATUS_CODE = 4;
const FAKE_VIDEO_SIZE_BYTES = 1_000_000n;
const FAKE_VIDEO_DURATION_SECONDS = 30;

/**
 * Para desarrollo y tests: no llama a ningún servicio. Cualquier vídeo se da por subido y listo,
 * y los enlaces apuntan a un dominio que no existe, así que nada se reproduce de verdad.
 */
export class FakeVideoHosting implements VideoHosting {
  readonly deletedVideoIds: string[] = [];

  createVideo(): Promise<{ providerVideoId: string }> {
    return Promise.resolve({ providerVideoId: generateUuidV7() });
  }

  signUpload(providerVideoId: string): VideoUploadTarget {
    return {
      endpoint: `${FAKE_HOST}/tusupload`,
      headers: { VideoId: providerVideoId, AuthorizationSignature: 'fake', LibraryId: 'fake' },
      expiresAt: new Date(Date.now() + LINK_LIFETIME_MS),
    };
  }

  fetchProcessingState(): Promise<VideoProcessingState | null> {
    return Promise.resolve({
      bunnyStatusCode: BUNNY_FINISHED_STATUS_CODE,
      sizeBytes: FAKE_VIDEO_SIZE_BYTES,
      durationSeconds: FAKE_VIDEO_DURATION_SECONDS,
    });
  }

  signPlayback(providerVideoId: string): VideoPlaybackLinks {
    return {
      streamUrl: `${FAKE_HOST}/${providerVideoId}/playlist.m3u8`,
      thumbnailUrl: `${FAKE_HOST}/${providerVideoId}/thumbnail.jpg`,
      expiresAt: new Date(Date.now() + LINK_LIFETIME_MS),
    };
  }

  deleteVideo(providerVideoId: string): Promise<void> {
    this.deletedVideoIds.push(providerVideoId);
    return Promise.resolve();
  }
}
