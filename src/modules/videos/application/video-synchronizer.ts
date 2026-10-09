import { Inject, Injectable, Logger } from '@nestjs/common';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import {
  decideReportedVideoSize,
  isUploadStale,
  mapBunnyStatusToVideoStatus,
  type ReportedVideoSizeDecision,
} from '../domain/video-rules';
import { VIDEO_HOSTING, type VideoHosting, type VideoProcessingState } from './ports/video-hosting';
import {
  VIDEO_REPOSITORY,
  type InFlightVideo,
  type ProcessingUpdate,
  type StoredVideo,
  type VideoRepository,
} from './ports/video.repository';

const NO_BYTES = BigInt(0);
const FAILED_UPDATE: ProcessingUpdate = {
  status: 'failed',
  sizeBytes: NO_BYTES,
  durationSeconds: null,
};

/** Por qué se descarta un vídeo: queda en el registro, no en la base de datos. */
const DISCARD_REASONS: Readonly<Record<Exclude<ReportedVideoSizeDecision, 'accepted'>, string>> = {
  too_large: 'the real size is over the maximum allowed',
  quota_exceeded: 'the real size does not fit in the space of the plan',
};

/**
 * Pone al día un vídeo con lo que dice el servicio de vídeo. Lo que el móvil declaró al reservar
 * solo vale hasta conocer el tamaño real; si el real no cabe, el vídeo se borra del servicio.
 */
@Injectable()
export class VideoSynchronizer {
  private readonly logger = new Logger(VideoSynchronizer.name);

  constructor(
    @Inject(VIDEO_REPOSITORY) private readonly videos: VideoRepository,
    @Inject(VIDEO_HOSTING) private readonly hosting: VideoHosting,
  ) {}

  async sync(actor: ActorContext, video: StoredVideo): Promise<StoredVideo> {
    const state = await this.hosting.fetchProcessingState(video.providerVideoId);
    const update = state ? await this.buildUpdate(actor, video, state) : FAILED_UPDATE;
    const stored = await this.videos.applyProcessingUpdate(actor, video.id, update);
    if (update.status === 'failed') await this.deleteFromHosting(video.providerVideoId);
    return stored ?? video;
  }

  /**
   * No hay tarea en segundo plano: antes de reservar otra subida se ponen al día las que el centro
   * tiene a medias, para que cuenten por lo que pesan de verdad y las abandonadas se limpien.
   * Si el servicio de vídeo falla no se impide reservar: el tope de subidas a la vez sigue en pie.
   */
  async reconcileInFlight(actor: ActorContext): Promise<void> {
    for (const video of await this.videos.listInFlight(actor)) {
      try {
        await this.reconcile(actor, video);
      } catch (error) {
        this.logger.warn(`Could not reconcile video ${video.id}`, error);
      }
    }
  }

  private async reconcile(actor: ActorContext, video: InFlightVideo): Promise<void> {
    const isAbandoned = video.status === 'uploading' && isUploadStale(video.createdAt, new Date());
    if (!isAbandoned) {
      await this.sync(actor, video);
      return;
    }
    this.logger.warn(`Discarding video ${video.id}: the upload never finished`);
    await this.videos.applyProcessingUpdate(actor, video.id, FAILED_UPDATE);
    await this.deleteFromHosting(video.providerVideoId);
  }

  private async buildUpdate(
    actor: ActorContext,
    video: StoredVideo,
    state: VideoProcessingState,
  ): Promise<ProcessingUpdate> {
    const status = mapBunnyStatusToVideoStatus(state.bunnyStatusCode);
    const update = { status, sizeBytes: video.sizeBytes, durationSeconds: state.durationSeconds };
    // Mientras el servicio no sabe lo que pesa (0), sigue valiendo lo declarado.
    if (state.sizeBytes === NO_BYTES) return update;
    const decision = await this.decideRealSize(actor, video, state.sizeBytes);
    if (decision === 'accepted') return { ...update, sizeBytes: state.sizeBytes };
    this.logger.warn(`Discarding video ${video.id}: ${DISCARD_REASONS[decision]}`);
    return FAILED_UPDATE;
  }

  private async decideRealSize(
    actor: ActorContext,
    video: StoredVideo,
    reportedBytes: bigint,
  ): Promise<ReportedVideoSizeDecision> {
    const facts = await this.videos.readStorageFacts(actor);
    const ownBytes = video.status === 'failed' ? NO_BYTES : video.sizeBytes;
    return decideReportedVideoSize({
      reportedBytes,
      storageLimitBytes: facts.storageLimitBytes,
      usedByOtherVideosBytes: facts.usedBytes - ownBytes,
    });
  }

  /** Un vídeo que sobra en el servicio solo cuesta dinero: se intenta borrar y, si falla, queda constancia. */
  private async deleteFromHosting(providerVideoId: string): Promise<void> {
    try {
      await this.hosting.deleteVideo(providerVideoId);
    } catch (error) {
      this.logger.warn(`Could not delete video ${providerVideoId} from the hosting service`, error);
    }
  }
}
