import { Inject, Injectable, Logger } from '@nestjs/common';
import { v7 as generateUuidV7 } from 'uuid';
import { type ErrorCode } from '../../../shared/errors/error-catalog.es';
import { DomainError } from '../../../shared/errors/domain-error';
import { HTTP_STATUS } from '../../../shared/errors/http-status';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import {
  decideVideoUpload,
  mapBunnyStatusToVideoStatus,
  type VideoUploadDecision,
} from '../domain/video-rules';
import { VIDEO_HOSTING, type VideoHosting, type VideoUploadTarget } from './ports/video-hosting';
import {
  VIDEO_REPOSITORY,
  type StoredVideo,
  type VideoAttachment,
  type VideoRepository,
  type VideoStorageFacts,
} from './ports/video.repository';

const REFUSED_UPLOAD_ERRORS: Readonly<
  Record<Exclude<VideoUploadDecision, 'allowed'>, readonly [ErrorCode, number]>
> = {
  not_included: ['VIDEO_NOT_INCLUDED', HTTP_STATUS.forbidden],
  too_large: ['VIDEO_TOO_LARGE', HTTP_STATUS.payloadTooLarge],
  quota_exceeded: ['VIDEO_QUOTA_EXCEEDED', HTTP_STATUS.conflict],
};

const MAX_TECHNIQUE_VIDEOS = 3;

function resolveAttachment(request: StartVideoUploadRequest): VideoAttachment | null {
  if (request.purpose === 'exercise') return null;
  return { kind: request.purpose, membershipId: request.actor.membershipId };
}

export interface StartVideoUploadRequest {
  readonly actor: ActorContext;
  readonly title: string;
  readonly sizeBytes: number;
  readonly purpose: 'exercise' | 'profile' | 'technique';
}

@Injectable()
export class StartVideoUploadUseCase {
  private readonly logger = new Logger(StartVideoUploadUseCase.name);

  constructor(
    @Inject(VIDEO_REPOSITORY) private readonly videos: VideoRepository,
    @Inject(VIDEO_HOSTING) private readonly hosting: VideoHosting,
  ) {}

  async execute(
    request: StartVideoUploadRequest,
  ): Promise<{ video: StoredVideo; upload: VideoUploadTarget }> {
    await this.assertUploadAllowed(request);
    await this.assertTechniqueRoom(request);
    const { providerVideoId } = await this.hosting.createVideo(request.title);
    const videoId = generateUuidV7();
    await this.saveOrDiscard(request, { videoId, providerVideoId });
    const video = await this.videos.find(request.actor, videoId);
    if (!video) throw new DomainError('INTERNAL_ERROR', HTTP_STATUS.internalServerError);
    return { video, upload: this.hosting.signUpload(providerVideoId) };
  }

  private async assertUploadAllowed(request: StartVideoUploadRequest): Promise<void> {
    const facts = await this.videos.readStorageFacts(request.actor);
    const decision = decideVideoUpload({ ...facts, requestedBytes: BigInt(request.sizeBytes) });
    if (decision === 'allowed') return;
    const [code, httpStatus] = REFUSED_UPLOAD_ERRORS[decision];
    throw new DomainError(code, httpStatus);
  }

  private async assertTechniqueRoom(request: StartVideoUploadRequest): Promise<void> {
    if (request.purpose !== 'technique') return;
    const count = await this.videos.countTechniqueVideos(request.actor, request.actor.membershipId);
    if (count >= MAX_TECHNIQUE_VIDEOS) {
      throw new DomainError('TECHNIQUE_VIDEO_LIMIT_REACHED', HTTP_STATUS.conflict);
    }
  }

  private async saveOrDiscard(
    request: StartVideoUploadRequest,
    ids: { videoId: string; providerVideoId: string },
  ): Promise<void> {
    try {
      const { replacedProviderVideoId } = await this.videos.create(request.actor, {
        id: ids.videoId,
        providerVideoId: ids.providerVideoId,
        title: request.title,
        requestedBytes: BigInt(request.sizeBytes),
        attachment: resolveAttachment(request),
      });
      if (replacedProviderVideoId !== null) await this.deleteFromHosting(replacedProviderVideoId);
    } catch (error) {
      await this.deleteFromHosting(ids.providerVideoId);
      throw error;
    }
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

@Injectable()
export class GetVideoPlanUseCase {
  constructor(@Inject(VIDEO_REPOSITORY) private readonly videos: VideoRepository) {}

  async execute(actor: ActorContext): Promise<VideoStorageFacts> {
    return this.videos.readStorageFacts(actor);
  }
}

@Injectable()
export class GetVideoUseCase {
  constructor(
    @Inject(VIDEO_REPOSITORY) private readonly videos: VideoRepository,
    @Inject(VIDEO_HOSTING) private readonly hosting: VideoHosting,
  ) {}

  /** Mientras el vídeo se sube o se procesa, pregunta al servicio de vídeo y guarda el estado nuevo. */
  async execute(actor: ActorContext, videoId: string): Promise<StoredVideo> {
    const video = await this.videos.find(actor, videoId);
    if (!video) throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
    if (video.status === 'ready' || video.status === 'failed') return video;
    const state = await this.hosting.fetchProcessingState(video.providerVideoId);
    const update = state
      ? {
          status: mapBunnyStatusToVideoStatus(state.bunnyStatusCode),
          sizeBytes: state.sizeBytes,
          durationSeconds: state.durationSeconds,
        }
      : { status: 'failed' as const, sizeBytes: 0n, durationSeconds: null };
    return (await this.videos.applyProcessingUpdate(actor, videoId, update)) ?? video;
  }
}

@Injectable()
export class DeleteVideoUseCase {
  constructor(
    @Inject(VIDEO_REPOSITORY) private readonly videos: VideoRepository,
    @Inject(VIDEO_HOSTING) private readonly hosting: VideoHosting,
  ) {}

  /** El equipo borra los suyos; quien administra, cualquiera. */
  async execute(actor: ActorContext, videoId: string): Promise<void> {
    const video = await this.videos.find(actor, videoId);
    if (!video) throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
    const isAdministrator = actor.role === 'owner' || actor.role === 'admin';
    if (!isAdministrator && video.uploadedByMembershipId !== actor.membershipId) {
      throw new DomainError('FORBIDDEN', HTTP_STATUS.forbidden);
    }
    await this.videos.delete(actor, videoId);
    await this.hosting.deleteVideo(video.providerVideoId);
  }
}
