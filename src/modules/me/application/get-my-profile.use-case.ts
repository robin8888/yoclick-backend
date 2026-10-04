import { Inject, Injectable } from '@nestjs/common';
import { accountGoneError } from './account-gone.error';
import {
  PROFILE_REPOSITORY,
  type Profile,
  type ProfileRepository,
} from './ports/profile.repository';

@Injectable()
export class GetMyProfileUseCase {
  constructor(@Inject(PROFILE_REPOSITORY) private readonly profiles: ProfileRepository) {}

  async execute(userId: string): Promise<Profile> {
    const profile = await this.profiles.getProfile(userId);
    if (!profile) throw accountGoneError();
    return profile;
  }
}
