import { Inject, Injectable } from '@nestjs/common';
import { isVideoVisibleToClients } from '../domain/video-rules';
import { VIDEO_HOSTING, type VideoHosting } from './ports/video-hosting';
import { type StoredVideo } from './ports/video.repository';

export interface VideoPlaybackView {
  readonly streamUrl: string;
  readonly thumbnailUrl: string;
  readonly expiresAt: string;
}

export interface VideoView {
  readonly id: string;
  readonly title: string;
  readonly status: StoredVideo['status'];
  readonly reviewStatus: StoredVideo['reviewStatus'];
  readonly reviewNote: string | null;
  readonly durationSeconds: number | null;
  /** Enlaces firmados que caducan; solo mientras el vídeo está listo y a la vista de quien lo pide. */
  readonly playback: VideoPlaybackView | null;
}

/** Convierte un vídeo guardado en lo que ve la app, firmando el enlace de reproducción en el momento. */
@Injectable()
export class VideoPresenter {
  constructor(@Inject(VIDEO_HOSTING) private readonly hosting: VideoHosting) {}

  present(video: StoredVideo, viewer: { readonly isClient: boolean }): VideoView {
    const canPlay = viewer.isClient ? isVideoVisibleToClients(video) : video.status === 'ready';
    const links = canPlay ? this.hosting.signPlayback(video.providerVideoId) : null;
    return {
      id: video.id,
      title: video.title,
      status: video.status,
      reviewStatus: video.reviewStatus,
      reviewNote: video.reviewNote,
      durationSeconds: video.durationSeconds,
      playback: links && {
        streamUrl: links.streamUrl,
        thumbnailUrl: links.thumbnailUrl,
        expiresAt: links.expiresAt.toISOString(),
      },
    };
  }
}
