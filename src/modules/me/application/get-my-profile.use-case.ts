import { Inject, Injectable } from '@nestjs/common';
import { PhotoUrlSigner, type WithPhotoUrl } from '../../photos/application/photo-url-signer';
import { accountGoneError } from './account-gone.error';
import {
  PROFILE_REPOSITORY,
  type Profile,
  type ProfileRepository,
} from './ports/profile.repository';

@Injectable()
export class GetMyProfileUseCase {
  constructor(
    @Inject(PROFILE_REPOSITORY) private readonly profiles: ProfileRepository,
    private readonly urlSigner: PhotoUrlSigner,
  ) {}

  async execute(userId: string): Promise<WithPhotoUrl<Profile>> {
    const profile = await this.profiles.getProfile(userId);
    if (!profile) throw accountGoneError();
    return this.urlSigner.attachPhotoUrl(profile);
  }
}
