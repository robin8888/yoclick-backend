import { Inject, Injectable } from '@nestjs/common';
import {
  PROFILE_REPOSITORY,
  type ConsentState,
  type ProfileRepository,
} from './ports/profile.repository';

@Injectable()
export class GetMyConsentsUseCase {
  constructor(@Inject(PROFILE_REPOSITORY) private readonly profiles: ProfileRepository) {}

  async execute(userId: string): Promise<ConsentState[]> {
    return this.profiles.listLatestConsents(userId);
  }
}
