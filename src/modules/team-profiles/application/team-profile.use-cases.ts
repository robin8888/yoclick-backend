import { Inject, Injectable } from '@nestjs/common';
import { v7 as generateUuidV7 } from 'uuid';
import { DomainError } from '../../../shared/errors/domain-error';
import { HTTP_STATUS } from '../../../shared/errors/http-status';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { PhotoFileKeeper } from '../../photos/application/photo-file-keeper';
import { buildGalleryPhotoKey } from '../../photos/domain/photo-rules';
import { isVideoVisibleToClients } from '../../videos/domain/video-rules';
import {
  canClientsSeeProfile,
  decideProfileSubmission,
  normalizeTextList,
} from '../domain/profile-rules';
import {
  TEAM_PROFILE_REPOSITORY,
  type AddPhotoOutcome,
  type ProfileView,
  type TeamProfileRepository,
  type TeamSettings,
} from './ports/team-profile.repository';

/**
 * Quien aún no ha publicado su perfil sale igualmente en el equipo (la clientela tiene que saber
 * quién le da clase), pero solo con su nombre y su cargo: nada de lo que está sin revisar.
 */
function toIntroductionOnly(profile: ProfileView): ProfileView {
  return {
    ...profile,
    // La foto es de lo que se publica: hasta entonces solo el nombre y el cargo.
    photoKey: null,
    headline: null,
    bio: null,
    specialties: [],
    languages: [],
    reviewNote: null,
    certifications: [],
    introVideo: null,
    techniqueVideos: [],
    rating: null,
    photos: [],
  };
}

/** Lo que cada persona puede ver de un perfil: la clientela todo lo publicado y, del resto, su nombre y cargo; el equipo, lo publicado y lo suyo. */
function shapeProfileForViewer(profile: ProfileView, actor: ActorContext): ProfileView | null {
  const isAdministrator = actor.role === 'owner' || actor.role === 'admin';
  if (isAdministrator || profile.membershipId === actor.membershipId) return profile;
  if (!canClientsSeeProfile(profile.status)) return toIntroductionOnly(profile);
  return {
    ...profile,
    reviewNote: null,
    introVideo:
      profile.introVideo && isVideoVisibleToClients(profile.introVideo) ? profile.introVideo : null,
    techniqueVideos: profile.techniqueVideos.filter((video) => isVideoVisibleToClients(video)),
  };
}

@Injectable()
export class ListTeamProfilesUseCase {
  constructor(@Inject(TEAM_PROFILE_REPOSITORY) private readonly profiles: TeamProfileRepository) {}

  async execute(actor: ActorContext): Promise<ProfileView[]> {
    const everyone = await this.profiles.listProfiles(actor);
    return everyone.flatMap((profile) => shapeProfileForViewer(profile, actor) ?? []);
  }
}

@Injectable()
export class GetTeamProfileUseCase {
  constructor(@Inject(TEAM_PROFILE_REPOSITORY) private readonly profiles: TeamProfileRepository) {}

  async execute(actor: ActorContext, membershipId: string): Promise<ProfileView> {
    const profile = await this.profiles.findProfile(actor, membershipId);
    const visible = profile && shapeProfileForViewer(profile, actor);
    if (!visible) throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
    return visible;
  }
}

export interface SaveMyProfileRequest {
  readonly actor: ActorContext;
  readonly headline: string | null;
  readonly bio: string | null;
  readonly specialties: readonly string[];
  readonly languages: readonly string[];
  readonly hasPublishConsent: boolean;
}

@Injectable()
export class SaveMyProfileUseCase {
  constructor(@Inject(TEAM_PROFILE_REPOSITORY) private readonly profiles: TeamProfileRepository) {}

  /** Guarda lo escrito; el perfil vuelve a borrador hasta que se envíe de nuevo a revisión. */
  async execute(request: SaveMyProfileRequest): Promise<ProfileView> {
    await this.profiles.saveContent(request.actor, {
      headline: request.headline,
      bio: request.bio,
      specialties: normalizeTextList(request.specialties),
      languages: normalizeTextList(request.languages),
      hasPublishConsent: request.hasPublishConsent,
    });
    return this.readOwn(request.actor);
  }

  async readOwn(actor: ActorContext): Promise<ProfileView> {
    const profile = await this.profiles.findProfile(actor, actor.membershipId);
    if (!profile) throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
    return profile;
  }
}

@Injectable()
export class SubmitMyProfileUseCase {
  constructor(@Inject(TEAM_PROFILE_REPOSITORY) private readonly profiles: TeamProfileRepository) {}

  async execute(actor: ActorContext): Promise<ProfileView> {
    const current = await this.profiles.findProfile(actor, actor.membershipId);
    if (!current) throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
    const decision = decideProfileSubmission({
      role: actor.role,
      hasPublishConsent: current.hasPublishConsent,
      headline: current.headline,
      bio: current.bio,
      hasIntroVideo: current.introVideo !== null,
    });
    if (decision.kind === 'consent_required') {
      throw new DomainError('PROFILE_CONSENT_REQUIRED', HTTP_STATUS.conflict);
    }
    if (decision.kind === 'empty_profile') {
      throw new DomainError('PROFILE_EMPTY', HTTP_STATUS.conflict);
    }
    await this.profiles.submit(actor, decision.status);
    const submitted = await this.profiles.findProfile(actor, actor.membershipId);
    if (!submitted) throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
    return submitted;
  }
}

@Injectable()
export class ManageMyCertificationsUseCase {
  constructor(@Inject(TEAM_PROFILE_REPOSITORY) private readonly profiles: TeamProfileRepository) {}

  async add(request: { actor: ActorContext; name: string; detail: string | null }): Promise<void> {
    const outcome = await this.profiles.addCertification(request.actor, {
      id: generateUuidV7(),
      name: request.name,
      detail: request.detail,
    });
    if (outcome.kind === 'limit_reached') {
      throw new DomainError('CERTIFICATION_LIMIT_REACHED', HTTP_STATUS.conflict);
    }
  }

  async remove(actor: ActorContext, certificationId: string): Promise<void> {
    if (!(await this.profiles.removeCertification(actor, certificationId))) {
      throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
    }
  }
}

@Injectable()
export class ManageMyPhotosUseCase {
  constructor(
    @Inject(TEAM_PROFILE_REPOSITORY) private readonly profiles: TeamProfileRepository,
    private readonly files: PhotoFileKeeper,
  ) {}

  /** Añade una foto a mi galería; el perfil vuelve a borrador, como al guardar su contenido. */
  async add(request: { actor: ActorContext; bytes: Buffer }): Promise<void> {
    const { actor, bytes } = request;
    const format = this.files.assertAcceptable(bytes);
    const id = this.files.newPhotoId();
    const key = buildGalleryPhotoKey({
      centerId: actor.centerId,
      membershipId: actor.membershipId,
      photoId: id,
      format,
    });
    await this.files.save({ key, bytes });
    const outcome = await this.addOrDiscard(actor, { id, key, sizeBytes: bytes.length });
    if (outcome.kind === 'added') return;
    await this.files.discard(key);
    const code =
      outcome.kind === 'limit_reached' ? 'PROFILE_PHOTO_LIMIT_REACHED' : 'PHOTO_QUOTA_EXCEEDED';
    throw new DomainError(code, HTTP_STATUS.conflict);
  }

  /** Un fichero que sobra en el almacén solo cuesta dinero: si no se pudo guardar, se borra. */
  private async addOrDiscard(
    actor: ActorContext,
    photo: { id: string; key: string; sizeBytes: number },
  ): Promise<AddPhotoOutcome> {
    try {
      return await this.profiles.addPhoto(actor, photo);
    } catch (error) {
      await this.files.discard(photo.key);
      throw error;
    }
  }

  async remove(actor: ActorContext, photoId: string): Promise<void> {
    const removedKey = await this.profiles.removePhoto(actor, photoId);
    if (removedKey === null) throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
    await this.files.discard(removedKey);
  }
}

@Injectable()
export class ModerateTeamProfileUseCase {
  constructor(@Inject(TEAM_PROFILE_REPOSITORY) private readonly profiles: TeamProfileRepository) {}

  async review(request: {
    actor: ActorContext;
    membershipId: string;
    isApproved: boolean;
    note: string | null;
  }): Promise<void> {
    const outcome = await this.profiles.review(request.actor, request);
    if (outcome.kind === 'not_found') throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
    if (outcome.kind === 'not_pending') {
      throw new DomainError('PROFILE_NOT_REVIEWABLE', HTTP_STATUS.conflict);
    }
  }

  async verifyCertification(actor: ActorContext, certificationId: string): Promise<void> {
    if (!(await this.profiles.verifyCertification(actor, certificationId))) {
      throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
    }
  }
}

@Injectable()
export class TeamSettingsUseCase {
  constructor(@Inject(TEAM_PROFILE_REPOSITORY) private readonly profiles: TeamProfileRepository) {}

  read(actor: ActorContext): Promise<TeamSettings> {
    return this.profiles.readSettings(actor);
  }

  save(actor: ActorContext, settings: Partial<TeamSettings>): Promise<TeamSettings> {
    return this.profiles.saveSettings(actor, settings);
  }
}
