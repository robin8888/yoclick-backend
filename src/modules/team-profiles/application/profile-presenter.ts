import { Injectable } from '@nestjs/common';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { PhotoUrlSigner } from '../../photos/application/photo-url-signer';
import { VideoPresenter } from '../../videos/application/video-presenter';
import { type ProfileView } from './ports/team-profile.repository';
import { type StaffReviewView } from './ports/staff-review.repository';

/** Convierte un perfil en lo que ve la app, firmando los enlaces de sus vídeos en el momento. */
@Injectable()
export class ProfilePresenter {
  constructor(
    private readonly videoPresenter: VideoPresenter,
    private readonly photoUrlSigner: PhotoUrlSigner,
  ) {}

  present(profile: ProfileView, actor: ActorContext): Record<string, unknown> {
    const viewer = { isClient: actor.role === 'client' };
    return {
      membershipId: profile.membershipId,
      isMe: profile.membershipId === actor.membershipId,
      role: profile.role,
      fullName: profile.fullName,
      photoUrl: this.photoUrlSigner.sign(profile.photoKey),
      photos: this.photoUrlSigner.signGallery(profile.photos),
      staffTitle: profile.staffTitle,
      headline: profile.headline,
      bio: profile.bio,
      specialties: [...profile.specialties],
      languages: [...profile.languages],
      status: profile.status,
      reviewNote: profile.reviewNote,
      hasPublishConsent: profile.hasPublishConsent,
      certifications: profile.certifications.map((certification) => ({ ...certification })),
      introVideo: profile.introVideo && this.videoPresenter.present(profile.introVideo, viewer),
      techniqueVideos: profile.techniqueVideos.map((video) =>
        this.videoPresenter.present(video, viewer),
      ),
      rating: profile.rating && { ...profile.rating },
    };
  }
}

export function serializeReview(review: StaffReviewView): Record<string, unknown> {
  return { ...review, createdAt: review.createdAt.toISOString() };
}
