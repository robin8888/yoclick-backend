import { Inject, Injectable, Logger } from '@nestjs/common';
import { v7 as generateUuidV7 } from 'uuid';
import { type ErrorCode } from '../../../shared/errors/error-catalog.es';
import { DomainError } from '../../../shared/errors/domain-error';
import { HTTP_STATUS } from '../../../shared/errors/http-status';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import {
  decideInitialReviewStatus,
  decideVideoUpload,
  isVideoVisibleToClients,
  mapBunnyStatusToVideoStatus,
  type VideoUploadDecision,
} from '../domain/video-rules';
import { VIDEO_HOSTING, type VideoHosting, type VideoUploadTarget } from './ports/video-hosting';
import {
  VIDEO_REPOSITORY,
  type StoredVideo,
  type TeamProfileView,
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

export interface StartVideoUploadRequest {
  readonly actor: ActorContext;
  readonly title: string;
  readonly sizeBytes: number;
  readonly purpose: 'exercise' | 'profile';
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

  private async saveOrDiscard(
    request: StartVideoUploadRequest,
    ids: { videoId: string; providerVideoId: string },
  ): Promise<void> {
    const isProfile = request.purpose === 'profile';
    try {
      const { replacedProviderVideoId } = await this.videos.create(request.actor, {
        id: ids.videoId,
        providerVideoId: ids.providerVideoId,
        title: request.title,
        requestedBytes: BigInt(request.sizeBytes),
        reviewStatus: isProfile ? decideInitialReviewStatus(request.actor.role) : 'approved',
        profileOfMembershipId: isProfile ? request.actor.membershipId : null,
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

export interface ReviewVideoRequest {
  readonly actor: ActorContext;
  readonly videoId: string;
  readonly isApproved: boolean;
  readonly note: string | null;
}

@Injectable()
export class ReviewVideoUseCase {
  constructor(@Inject(VIDEO_REPOSITORY) private readonly videos: VideoRepository) {}

  async execute(request: ReviewVideoRequest): Promise<StoredVideo> {
    const outcome = await this.videos.review(request.actor, request);
    if (outcome.kind === 'not_found') throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
    if (outcome.kind === 'not_reviewable') {
      throw new DomainError('VIDEO_NOT_REVIEWABLE', HTTP_STATUS.conflict);
    }
    return outcome.video;
  }
}

@Injectable()
export class ListTeamProfilesUseCase {
  constructor(@Inject(VIDEO_REPOSITORY) private readonly videos: VideoRepository) {}

  /** La clientela solo ve a quien tiene un vídeo listo y aprobado; la administración, a todo el equipo. */
  async execute(actor: ActorContext): Promise<TeamProfileView[]> {
    const profiles = await this.videos.listTeamProfiles(actor);
    if (actor.role !== 'client') return profiles;
    return profiles.filter(({ video }) => video !== null && isVideoVisibleToClients(video));
  }
}
