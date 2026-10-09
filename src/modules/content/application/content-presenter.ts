import { Inject, Injectable } from '@nestjs/common';
import { VIDEO_HOSTING, type VideoHosting } from '../../videos/application/ports/video-hosting';
import { type StoredContent, type StoredContentAssignment } from './ports/content.repository';
import { FILE_STORAGE, type FileStorage } from './ports/file-storage';

export interface ContentView {
  readonly id: string;
  readonly kind: StoredContent['kind'];
  readonly title: string;
  readonly need: string | null;
  readonly level: StoredContent['level'];
  readonly sizeBytes: number;
  readonly pageCount: number | null;
  readonly durationSeconds: number | null;
  /** Un vídeo todavía en proceso no se puede ver; un PDF siempre está listo. */
  readonly isReady: boolean;
  readonly thumbnailUrl: string | null;
  readonly createdAt: string;
  readonly assignments: readonly StoredContentAssignment[];
}

export interface ContentDetailView extends ContentView {
  /** Enlaces firmados que caducan, para reproducir el vídeo. */
  readonly playback: { streamUrl: string; thumbnailUrl: string; expiresAt: string } | null;
  /** Enlace firmado que caduca, para leer o descargar el PDF. */
  readonly document: { url: string; expiresAt: string } | null;
  /** Enlace firmado que caduca, para ver la imagen. */
  readonly image: { url: string; expiresAt: string } | null;
}

/** Convierte una pieza guardada en lo que ve la app, firmando los enlaces en el momento. */
@Injectable()
export class ContentPresenter {
  constructor(
    @Inject(VIDEO_HOSTING) private readonly videoHosting: VideoHosting,
    @Inject(FILE_STORAGE) private readonly fileStorage: FileStorage,
  ) {}

  present(content: StoredContent): ContentView {
    const isReady = content.video === null || content.video.status === 'ready';
    const links =
      content.video && isReady
        ? this.videoHosting.signPlayback(content.video.providerVideoId)
        : null;
    return {
      id: content.id,
      kind: content.kind,
      title: content.title,
      need: content.need,
      level: content.level,
      sizeBytes: Number(content.sizeBytes),
      pageCount: content.pageCount,
      durationSeconds: content.video?.durationSeconds ?? null,
      isReady,
      thumbnailUrl: this.resolveThumbnailUrl(content, links?.thumbnailUrl ?? null),
      createdAt: content.createdAt.toISOString(),
      assignments: content.assignments,
    };
  }

  /** Una imagen es su propia miniatura: la app la pinta sin pedir el detalle. */
  private resolveThumbnailUrl(
    content: StoredContent,
    videoThumbnailUrl: string | null,
  ): string | null {
    if (content.kind === 'image' && content.documentKey) {
      return this.fileStorage.signDownload(content.documentKey).url;
    }
    return videoThumbnailUrl;
  }

  presentDetail(content: StoredContent): ContentDetailView {
    const view = this.present(content);
    const links =
      content.video && view.isReady
        ? this.videoHosting.signPlayback(content.video.providerVideoId)
        : null;
    const download = content.documentKey
      ? this.fileStorage.signDownload(content.documentKey)
      : null;
    const signed = download && { url: download.url, expiresAt: download.expiresAt.toISOString() };
    return {
      ...view,
      playback: links && {
        streamUrl: links.streamUrl,
        thumbnailUrl: links.thumbnailUrl,
        expiresAt: links.expiresAt.toISOString(),
      },
      document: content.kind === 'pdf' ? signed : null,
      image: content.kind === 'image' ? signed : null,
    };
  }
}
